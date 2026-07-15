import {
  createComment,
  listComments,
  patchRecords,
  submissionsCache,
  updateComment,
} from "../airtable";
import { badRequest, notFound } from "../errors";
import {
  decodePayload,
  encodePayload,
  payloadToEvent,
  type ApprovalPayload,
  type CommentPayload,
  type EventPayload,
  type RejectionPayload,
} from "../events";
import { buildGroups, deriveStatus, findGroupByRecordId } from "../grouping";
import {
  F,
  optNumber,
  optString,
  reqNumber,
  reqString,
  type ProjectGroup,
  type RecordComment,
} from "../types";

async function resolveGroup(shipId: string): Promise<ProjectGroup> {
  const group = findGroupByRecordId(buildGroups(await submissionsCache.get()), shipId);
  if (!group) throw notFound(`No ship found with ID ${shipId}.`);
  return group;
}

async function persistEvent(group: ProjectGroup, payload: EventPayload): Promise<unknown> {
  const comment = await createComment(group.primary.id, encodePayload(payload));
  return payloadToEvent(payload, comment.createdTime);
}

export async function submitReviewAction(input: Record<string, unknown>): Promise<unknown> {
  const shipId = reqString(input, "shipId");
  const reviewerId = reqString(input, "reviewerId");
  const action = reqString(input, "action");
  const group = await resolveGroup(shipId);
  const status = deriveStatus(group);
  const now = new Date().toISOString();

  switch (action) {
    case "approve": {
      if (input.rewardedHoursOverride !== undefined) {
        throw badRequest("This program does not support rewarded hours overrides.");
      }
      const hoursAssigned = reqNumber(input, "hoursAssigned");
      if (hoursAssigned < 0) throw badRequest("hoursAssigned must be >= 0");
      const justification = reqString(input, "justification");
      if (status === "approved") {
        throw badRequest("Ship is already approved; the Unified YSWS automation has run.");
      }

      // Every merged record flows into Unified YSWS independently, so each row
      // carries the reviewer-verified hours and justification.
      await patchRecords(
        group.members.map((record) => ({
          id: record.id,
          fields: {
            [F.submitToUnified]: true,
            [F.rejected]: false,
            [F.overrideHours]: hoursAssigned,
            [F.overrideJustification]: justification,
          },
        })),
      );
      const payload: ApprovalPayload = {
        kind: "approval",
        shipId: group.primary.id,
        actorId: reviewerId,
        hoursAssigned,
        ...(input.fields ? { fields: input.fields as Record<string, unknown> } : {}),
        justification,
        at: now,
      };
      const event = await persistEvent(group, payload);
      submissionsCache.invalidate();
      return { success: true, event };
    }

    case "reject": {
      if (status !== "pending") {
        throw badRequest(
          status === "approved"
            ? "Ship is already approved; rejecting cannot undo the Unified YSWS automation."
            : "Ship is already rejected.",
        );
      }
      await patchRecords(
        group.members.map((record) => ({ id: record.id, fields: { [F.rejected]: true } })),
      );
      const payload: RejectionPayload = {
        kind: "rejection",
        shipId: group.primary.id,
        actorId: reviewerId,
        ...(optString(input, "internalMessage")
          ? { internalMessage: optString(input, "internalMessage") }
          : {}),
        ...(input.fields ? { fields: input.fields as Record<string, unknown> } : {}),
        at: now,
      };
      const event = await persistEvent(group, payload);
      submissionsCache.invalidate();
      return { success: true, event };
    }

    case "comment":
    case "internal_comment": {
      const payload: CommentPayload = {
        kind: "comment",
        actorId: reviewerId,
        message: reqString(input, "commentText"),
        isInternal: action === "internal_comment",
        at: now,
      };
      return { success: true, event: await persistEvent(group, payload) };
    }

    case "authorize":
    case "deauthorize":
      throw badRequest("This program uses single-stage review; there is no pending_hq state.");

    default:
      throw badRequest(`Unknown review action: ${action}`);
  }
}

interface MatchedComment {
  comment: RecordComment;
  payload: ApprovalPayload | RejectionPayload;
}

function findLatestReview(
  comments: RecordComment[],
  kind: "approval" | "rejection",
  reviewerId: string,
): MatchedComment | null {
  let latest: MatchedComment | null = null;
  for (const comment of comments) {
    const payload = decodePayload(comment.text);
    if (!payload || payload.kind !== kind || payload.actorId !== reviewerId) continue;
    if (!latest || payload.at > latest.payload.at) latest = { comment, payload };
  }
  return latest;
}

export async function updateReviewAction(input: Record<string, unknown>): Promise<unknown> {
  const shipId = reqString(input, "shipId");
  const reviewerId = reqString(input, "reviewerId");
  const type = reqString(input, "type");
  if (type !== "approval" && type !== "rejection") {
    throw badRequest(`Invalid review type: ${type}`);
  }
  if (optNumber(input, "hoursAssigned") !== undefined) {
    throw badRequest(
      "Hour edits are only valid for pending_hq ships; this program is single-stage.",
    );
  }
  if (input.rewardedHoursOverride !== undefined && input.rewardedHoursOverride !== null) {
    throw badRequest("This program does not support rewarded hours overrides.");
  }
  // feedbackMessage is accepted but discarded: public feedback is never persisted.

  const group = await resolveGroup(shipId);
  const now = new Date().toISOString();
  const comments = await listComments(group.primary.id);
  const match = findLatestReview(comments, type, reviewerId);
  const fields = input.fields as Record<string, unknown> | undefined;

  if (type === "approval") {
    const justification = reqString(input, "justification");
    if (!match) {
      // Cover records approved by hand in Airtable: upsert the approval event.
      if (deriveStatus(group) !== "approved") {
        throw notFound("No approval by this reviewer found for this ship.");
      }
      const payload: ApprovalPayload = {
        kind: "approval",
        shipId: group.primary.id,
        actorId: reviewerId,
        hoursAssigned:
          (group.primary.fields[F.overrideHours] as number | undefined) ?? 0,
        justification,
        ...(fields ? { fields } : {}),
        at: now,
      };
      await createComment(group.primary.id, encodePayload(payload));
    } else {
      const payload: ApprovalPayload = {
        ...(match.payload as ApprovalPayload),
        kind: "approval",
        justification,
        ...(fields ? { fields } : {}),
        editedAt: now,
        editedBy: reviewerId,
      };
      await updateComment(group.primary.id, match.comment.id, encodePayload(payload));
    }
    await patchRecords(
      group.members.map((record) => ({
        id: record.id,
        fields: { [F.overrideJustification]: justification },
      })),
    );
    submissionsCache.invalidate();
    return { success: true };
  }

  // Rejection edit
  if (!match) throw notFound("No rejection by this reviewer found for this ship.");
  const internalMessage = optString(input, "internalMessage");
  const payload: RejectionPayload = {
    ...(match.payload as RejectionPayload),
    kind: "rejection",
    ...(internalMessage !== undefined ? { internalMessage } : {}),
    ...(fields ? { fields } : {}),
    editedAt: now,
    editedBy: reviewerId,
  };
  await updateComment(group.primary.id, match.comment.id, encodePayload(payload));
  return { success: true };
}
