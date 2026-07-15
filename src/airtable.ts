import { env } from "./env";
import { upstreamUnavailable } from "./errors";
import { TtlCache } from "./cache";
import type { RecordComment, SubmissionRecord } from "./types";

const API_BASE = "https://api.airtable.com/v0";
const REQUEST_SPACING_MS = 220; // stays under Airtable's 5 rps/base limit
const MAX_QUEUE_WAIT_MS = 20_000; // Sidekick times out at 30s; fail fast well before

let nextSlotAt = 0;

/** Space all outgoing Airtable requests >= REQUEST_SPACING_MS apart. */
async function rateLimit(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  if (slot - now > MAX_QUEUE_WAIT_MS) {
    throw upstreamUnavailable("Airtable request queue is saturated; try again shortly.");
  }
  nextSlotAt = slot + REQUEST_SPACING_MS;
  if (slot > now) await Bun.sleep(slot - now);
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    await rateLimit();
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${env.airtableApiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (response.ok) return response.json();

    if (response.status === 429 && attempt < 2) {
      await Bun.sleep(30_000); // Airtable's documented penalty window
      continue;
    }
    if (response.status >= 500 && attempt < 1) {
      await Bun.sleep(1_000);
      continue;
    }
    const body = await response.text().catch(() => "");
    console.error(`Airtable ${init?.method ?? "GET"} ${path} -> ${response.status}: ${body}`);
    throw upstreamUnavailable(`Airtable request failed with status ${response.status}.`);
  }
}

interface ListResponse {
  records: SubmissionRecord[];
  offset?: string;
}

async function listAllRecords(tableId: string): Promise<SubmissionRecord[]> {
  const records: SubmissionRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const page = (await request(
      `/${env.airtableBaseId}/${tableId}?${params}`,
    )) as ListResponse;
    records.push(...page.records);
    offset = page.offset;
  } while (offset);
  return records;
}

export async function patchRecords(
  updates: { id: string; fields: Record<string, unknown> }[],
): Promise<void> {
  for (let i = 0; i < updates.length; i += 10) {
    await request(`/${env.airtableBaseId}/${env.airtableTableId}`, {
      method: "PATCH",
      body: JSON.stringify({ records: updates.slice(i, i + 10) }),
    });
  }
}

// ---- Record comments ----

interface CommentsResponse {
  comments: { id: string; text: string; createdTime: string }[];
  offset?: string;
}

export async function listComments(recordId: string): Promise<RecordComment[]> {
  const comments: RecordComment[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (offset) params.set("offset", offset);
    const page = (await request(
      `/${env.airtableBaseId}/${env.airtableTableId}/${recordId}/comments?${params}`,
    )) as CommentsResponse;
    comments.push(...page.comments.map(({ id, text, createdTime }) => ({ id, text, createdTime })));
    offset = page.offset;
  } while (offset);
  return comments;
}

export async function createComment(recordId: string, text: string): Promise<RecordComment> {
  const created = (await request(
    `/${env.airtableBaseId}/${env.airtableTableId}/${recordId}/comments`,
    { method: "POST", body: JSON.stringify({ text }) },
  )) as RecordComment;
  return created;
}

export async function updateComment(
  recordId: string,
  commentId: string,
  text: string,
): Promise<void> {
  await request(
    `/${env.airtableBaseId}/${env.airtableTableId}/${recordId}/comments/${commentId}`,
    { method: "PATCH", body: JSON.stringify({ text }) },
  );
}

// ---- Cached table reads ----

export const submissionsCache = new TtlCache<SubmissionRecord[]>(env.cacheTtlMs, () =>
  listAllRecords(env.airtableTableId),
);

export const usersCache = new TtlCache<SubmissionRecord[]>(5 * 60_000, () =>
  listAllRecords(env.airtableUsersTableId),
);
