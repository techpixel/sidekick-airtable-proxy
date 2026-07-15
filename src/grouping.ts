import { badRequest } from "./errors";
import {
  F,
  fieldAttachmentUrl,
  fieldBool,
  fieldNumber,
  fieldString,
  type Project,
  type ProjectGroup,
  type Ship,
  type ShipStatus,
  type SubmissionRecord,
} from "./types";

/**
 * Normalize a Code URL into a merge key. Records with the same key are one project.
 * Returns null for empty values (each such record is its own project).
 */
export function normalizeCodeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return trimmed.toLowerCase();
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  let path = url.pathname.toLowerCase();
  path = path.replace(/\/+$/, "").replace(/\.git$/, "");
  return host + path;
}

export function submittedAt(record: SubmissionRecord): string {
  return fieldString(record, F.firstSubmittedAt) || record.createdTime;
}

/** Group records by normalized Code URL. Primary = earliest submission. */
export function buildGroups(records: SubmissionRecord[]): ProjectGroup[] {
  const byKey = new Map<string, SubmissionRecord[]>();
  for (const record of records) {
    const key = normalizeCodeUrl(fieldString(record, F.codeUrl)) ?? `__solo__:${record.id}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(record);
    else byKey.set(key, [record]);
  }
  const groups: ProjectGroup[] = [];
  for (const [key, members] of byKey) {
    members.sort((a, b) => {
      const timeOrder = submittedAt(a).localeCompare(submittedAt(b));
      return timeOrder !== 0 ? timeOrder : a.id.localeCompare(b.id);
    });
    groups.push({ key, primary: members[0]!, members });
  }
  return groups;
}

/**
 * Group status, OR-ed over members so manual per-record Airtable edits are respected:
 * any submitted-to-unified -> approved, else any rejected -> rejected, else pending.
 */
export function deriveStatus(group: ProjectGroup): ShipStatus {
  if (group.members.some((r) => fieldBool(r, F.submitToUnified))) return "approved";
  if (group.members.some((r) => fieldBool(r, F.rejected))) return "rejected";
  return "pending";
}

/** Mean of Original Hours over members that have one, rounded to 2 dp. 0 if none do. */
export function averageHours(group: ProjectGroup): number {
  const hours = group.members
    .map((r) => fieldNumber(r, F.originalHours))
    .filter((h): h is number => h !== null);
  if (hours.length === 0) return 0;
  return Math.round((hours.reduce((sum, h) => sum + h, 0) / hours.length) * 100) / 100;
}

export interface ResolvedActor {
  authorId: string;
  hackatimeId?: string;
}

export function groupToProject(group: ProjectGroup, actor: ResolvedActor): Project {
  const { primary, members } = group;
  const hours = averageHours(group);

  const codeUrl = fieldString(primary, F.codeUrl).trim();
  let title = fieldString(primary, F.projectName).trim();
  if (!title && codeUrl) title = codeUrl.replace(/\/+$/, "").split("/").pop() ?? "";
  if (!title) title = `Untitled project (${primary.id})`;

  let description = fieldString(primary, F.description).trim();
  let epilogue = `Author originally logged ${hours} hours.`;
  if (members.length > 1) {
    const perMember = members
      .map((r) => fieldNumber(r, F.originalHours))
      .map((h) => (h === null ? "?" : String(h)))
      .join(", ");
    epilogue += ` (average of ${members.length} merged submissions: ${perMember})`;
  }
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
  sortKey: [string, string]; // [submittedAt ISO, primary record id]
}

export function sortGroups(groups: ProjectGroup[]): SortedGroup[] {
  return groups
    .map((group) => ({
      group,
      sortKey: [submittedAt(group.primary), group.primary.id] as [string, string],
    }))
    .sort((a, b) => {
      const timeOrder = a.sortKey[0].localeCompare(b.sortKey[0]);
      return timeOrder !== 0 ? timeOrder : a.sortKey[1].localeCompare(b.sortKey[1]);
    });
}

interface CursorPayload {
  v: 1;
  s: string; // status filter the cursor was issued for
  a: [string, string]; // sort key of the last item on the previous page
}

export function encodeCursor(statusFilter: string, anchor: [string, string]): string {
  const payload: CursorPayload = { v: 1, s: statusFilter, a: anchor };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor(cursor: string, statusFilter: string): [string, string] {
  let payload: CursorPayload;
  try {
    payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (payload.v !== 1 || !Array.isArray(payload.a) || payload.a.length !== 2) throw new Error();
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
