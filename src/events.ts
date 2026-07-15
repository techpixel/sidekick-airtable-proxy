import {
  F,
  fieldNumber,
  fieldString,
  type ProjectGroup,
  type RecordComment,
  type TimelineEvent,
} from "./types";
import { claimedHours, deriveStatus, submittedAt } from "./grouping";
import type { ResolvedActor } from "./grouping";

export const COMMENT_PREFIX = "[sidekick:v1] ";

/** Public feedback is never persisted (per SIDEKICK.md); echoed as this constant. */
export const NO_FEEDBACK = "(none)";

/** Reviewer id used when a decision was made directly in Airtable, outside Sidekick. */
export const FALLBACK_REVIEWER_ID = "ident!airtable";

// Airtable comments cap out at 10k chars; leave headroom for the JSON envelope.
const MAX_TEXT_LENGTH = 9_000;

export interface ApprovalPayload {
  kind: "approval";
  shipId: string;
  actorId: string;
  hoursAssigned: number;
  justification: string;
  fields?: Record<string, unknown>;
  at: string;
  editedAt?: string;
  editedBy?: string;
}

export interface RejectionPayload {
  kind: "rejection";
  shipId: string;
  actorId: string;
  internalMessage?: string;
  fields?: Record<string, unknown>;
  at: string;
  editedAt?: string;
  editedBy?: string;
}

export interface CommentPayload {
  kind: "comment";
  actorId: string;
  message: string;
  isInternal: boolean;
  at: string;
}

export type EventPayload = ApprovalPayload | RejectionPayload | CommentPayload;

function truncate(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…[truncated]` : text;
}

export function encodePayload(payload: EventPayload): string {
  const bounded: EventPayload = { ...payload };
  if (bounded.kind === "approval") bounded.justification = truncate(bounded.justification);
  if (bounded.kind === "rejection" && bounded.internalMessage) {
    bounded.internalMessage = truncate(bounded.internalMessage);
  }
  if (bounded.kind === "comment") bounded.message = truncate(bounded.message);
  return COMMENT_PREFIX + JSON.stringify(bounded);
}

/** Parse a record comment. Returns null for human comments or malformed payloads. */
export function decodePayload(text: string): EventPayload | null {
  if (!text.startsWith(COMMENT_PREFIX)) return null;
  try {
    const payload = JSON.parse(text.slice(COMMENT_PREFIX.length)) as EventPayload;
    if (
      payload.kind !== "approval" &&
      payload.kind !== "rejection" &&
      payload.kind !== "comment"
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function payloadToEvent(payload: EventPayload, commentCreatedTime: string): TimelineEvent {
  const timestamp = payload.at || commentCreatedTime;
  switch (payload.kind) {
    case "approval":
      return {
        type: "approval",
        shipId: payload.shipId,
        actorId: payload.actorId,
        hoursAssigned: payload.hoursAssigned,
        feedbackMessage: NO_FEEDBACK,
        justification: payload.justification,
        ...(payload.fields ? { fields: payload.fields } : {}),
        timestamp,
      };
    case "rejection":
      return {
        type: "rejection",
        shipId: payload.shipId,
        actorId: payload.actorId,
        feedbackMessage: NO_FEEDBACK,
        ...(payload.internalMessage ? { internalMessage: payload.internalMessage } : {}),
        ...(payload.fields ? { fields: payload.fields } : {}),
        timestamp,
      };
    case "comment":
      return {
        type: "comment",
        actorId: payload.actorId,
        message: payload.message,
        isInternal: payload.isInternal,
        timestamp,
      };
  }
}

/**
 * Assemble the full timeline for a group: the single synthesized "ship" event,
 * decoded [sidekick:v1] comments, and — when the record was approved/rejected by
 * hand in Airtable with no corresponding comment — a synthesized decision event.
 */
export function buildTimeline(
  group: ProjectGroup,
  actor: ResolvedActor,
  comments: RecordComment[],
): TimelineEvent[] {
  const shipId = group.primary.id;
  const shippedAt = submittedAt(group.primary);

  const events: TimelineEvent[] = [
    {
      type: "ship",
      shipId,
      actorId: actor.authorId,
      hoursSubmitted: claimedHours(group),
      timestamp: shippedAt,
    },
  ];

  let hasApproval = false;
  let hasRejection = false;
  for (const comment of comments) {
    const payload = decodePayload(comment.text);
    if (!payload) continue;
    if (payload.kind === "approval") hasApproval = true;
    if (payload.kind === "rejection") hasRejection = true;
    events.push(payloadToEvent(payload, comment.createdTime));
  }

  const status = deriveStatus(group);
  if (status === "approved" && !hasApproval) {
    events.push({
      type: "approval",
      shipId,
      actorId: FALLBACK_REVIEWER_ID,
      hoursAssigned: fieldNumber(group.primary, F.overrideHours) ?? claimedHours(group),
      feedbackMessage: NO_FEEDBACK,
      justification:
        fieldString(group.primary, F.justification) || "(approved directly in Airtable)",
      timestamp: shippedAt,
    });
  } else if (status === "rejected" && !hasRejection) {
    events.push({
      type: "rejection",
      shipId,
      actorId: FALLBACK_REVIEWER_ID,
      feedbackMessage: NO_FEEDBACK,
      internalMessage: "(rejected directly in Airtable)",
      timestamp: shippedAt,
    });
  }

  return events.sort((a, b) => {
    const order = a.timestamp.localeCompare(b.timestamp);
    if (order !== 0) return order;
    return a.type === "ship" ? -1 : b.type === "ship" ? 1 : 0;
  });
}
