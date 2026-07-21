import { badRequest } from "./errors";
import {
  F,
  fieldAttachmentUrl,
  fieldNumber,
  fieldString,
  type Project,
  type ProjectGroup,
  type Ship,
  type ShipStatus,
  type SubmissionRecord,
} from "./types";

export function submittedAt(record: SubmissionRecord): string {
  return fieldString(record, F.firstSubmittedAt) || record.createdTime;
}

/** One project per submission record. Records are never merged. */
export function buildGroups(records: SubmissionRecord[]): ProjectGroup[] {
  return records.map((record) => ({ key: record.id, primary: record, members: [record] }));
}

/**
 * Ship status from the Status single-select: Approved -> approved,
 * Rejected -> rejected, else pending.
 */
export function deriveStatus(group: ProjectGroup): ShipStatus {
  const status = fieldString(group.primary, F.status);
  if (status === "Approved") return "approved";
  if (status === "Rejected") return "rejected";
  return "pending";
}

/** The record's Original Hours, or 0 if it has none. */
export function claimedHours(group: ProjectGroup): number {
  return fieldNumber(group.primary, F.originalHours) ?? 0;
}

export function projectTitle(record: SubmissionRecord): string {
  const codeUrl = fieldString(record, F.codeUrl).trim();
  let title = fieldString(record, F.projectName).trim();
  if (!title && codeUrl) title = codeUrl.replace(/\/+$/, "").split("/").pop() ?? "";
  return title || `Untitled project (${record.id})`;
}

export interface ResolvedActor {
  authorId: string;
  hackatimeId?: string;
}

export function groupToProject(group: ProjectGroup, actor: ResolvedActor): Project {
  const { primary, members } = group;
  const hours = claimedHours(group);

  const codeUrl = fieldString(primary, F.codeUrl).trim();
  const title = projectTitle(primary);

  let description = fieldString(primary, F.description).trim();
  const githubUsername = fieldString(primary, F.githubUsername).trim();
  const epilogueLines = [
    ...(githubUsername ? [`GitHub: ${githubUsername}`] : []),
    `Author originally logged ${hours} hours.`,
  ];
  const epilogue = epilogueLines.join("\n");
  description = description ? `${description}\n\n---\n${epilogue}` : epilogue;

  const hackatimeProjectKeys = [
    ...new Set(
      members.map((r) => fieldString(r, F.hackatimeProjectName).trim()).filter(Boolean),
    ),
  ];

  const demoUrl = fieldString(primary, F.playableUrl).trim();
  const screenshotUrl = fieldAttachmentUrl(primary, F.screenshot);

  const ship: Ship = {
    id: primary.id,
    hoursSubmitted: hours,
    submittedAt: submittedAt(primary),
    status: deriveStatus(group),
  };

  return {
    id: primary.id,
    title,
    description,
    codeUrl,
    ...(demoUrl ? { demoUrl } : {}),
    ...(screenshotUrl ? { screenshotUrl } : {}),
    authorId: actor.authorId,
    ...(actor.hackatimeId ? { hackatimeId: actor.hackatimeId } : {}),
    hackatimeProjectKeys,
    ships: [ship],
    metadata: {
      recordIds: members.map((r) => r.id),
      memberCount: members.length,
    },
  };
}

/** Find the group containing a record id (project id, ship id, or any merged member). */
export function findGroupByRecordId(
  groups: ProjectGroup[],
  recordId: string,
): ProjectGroup | undefined {
  return groups.find((g) => g.members.some((r) => r.id === recordId));
}

// ---- Cursor pagination over groups ----

export interface SortedGroup {
  group: ProjectGroup;
  sortKey: [string, string]; // [lowercased title, primary record id]
}

/**
 * Alphabetical by title, tiebroken by record id. Must order keys exactly like
 * pageAfter's comparison (plain codepoint order), or pagination skips items.
 */
export function sortGroups(groups: ProjectGroup[]): SortedGroup[] {
  return groups
    .map((group) => ({
      group,
      sortKey: [projectTitle(group.primary).toLowerCase(), group.primary.id] as [string, string],
    }))
    .sort((a, b) => {
      if (a.sortKey[0] !== b.sortKey[0]) return a.sortKey[0] < b.sortKey[0] ? -1 : 1;
      return a.sortKey[1] < b.sortKey[1] ? -1 : a.sortKey[1] > b.sortKey[1] ? 1 : 0;
    });
}

interface CursorPayload {
  v: 2;
  s: string; // status filter the cursor was issued for
  a: [string, string]; // sort key of the last item on the previous page
}

export function encodeCursor(statusFilter: string, anchor: [string, string]): string {
  const payload: CursorPayload = { v: 2, s: statusFilter, a: anchor };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor(cursor: string, statusFilter: string): [string, string] {
  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (payload.v !== 2 || !Array.isArray(payload.a) || payload.a.length !== 2) throw new Error();
  } catch {
    throw badRequest("Invalid pagination cursor.");
  }
  if (payload.s !== statusFilter) {
    throw badRequest("Pagination cursor does not match the requested status filter.");
  }
  return payload.a;
}

export function pageAfter(
  sorted: SortedGroup[],
  anchor: [string, string] | null,
  limit: number,
): { page: SortedGroup[]; hasMore: boolean } {
  const start = anchor
    ? sorted.findIndex(
        ({ sortKey }) =>
          sortKey[0] > anchor[0] || (sortKey[0] === anchor[0] && sortKey[1] > anchor[1]),
      )
    : 0;
  if (start === -1) return { page: [], hasMore: false };
  const page = sorted.slice(start, start + limit);
  return { page, hasMore: start + limit < sorted.length };
}

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  return Math.max(1, Math.min(100, Math.floor(limit)));
}
