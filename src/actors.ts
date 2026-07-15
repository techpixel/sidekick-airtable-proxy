import { env } from "./env";
import { usersCache } from "./airtable";
import { TtlMap } from "./cache";
import type { ResolvedActor } from "./grouping";
import type { SubmissionRecord } from "./types";

const UNRESOLVED_PREFIX = "ident!unresolved_";

interface Resolution {
  authorId: string | null; // null = nothing found; caller substitutes the record fallback
  hackatimeId?: string;
}

const resolutionCache = new TtlMap<Resolution>(
  24 * 60 * 60_000,
  15 * 60_000,
  (r) => r.authorId === null && r.hackatimeId === undefined,
);

function userField(record: SubmissionRecord, name: string): string {
  const value = record.fields[name];
  return typeof value === "string" ? value.trim() : "";
}

async function findUsersRow(email: string): Promise<SubmissionRecord | undefined> {
  const users = await usersCache.get();
  return users.find((row) => userField(row, "Email").toLowerCase() === email);
}

async function slackLookupByEmail(email: string): Promise<string | null> {
  if (!env.slackBotToken) return null;
  try {
    const response = await fetch(
      `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
      {
        headers: { Authorization: `Bearer ${env.slackBotToken}` },
        signal: AbortSignal.timeout(2_000),
      },
    );
    const body = (await response.json()) as { ok: boolean; user?: { id: string } };
    return body.ok && body.user?.id ? body.user.id : null;
  } catch {
    return null;
  }
}

async function hackatimeLookup(path: string): Promise<string | null> {
  if (!env.statsApiKey) return null;
  try {
    const response = await fetch(`${env.hackatimeBaseUrl}${path}`, {
      headers: { Authorization: `Bearer ${env.statsApiKey}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { user_id?: number };
    return body.user_id !== undefined ? String(body.user_id) : null;
  } catch {
    return null;
  }
}

async function resolve(email: string): Promise<Resolution> {
  let slackId: string | null = null;
  let identId: string | null = null;

  const usersRow = await findUsersRow(email);
  if (usersRow) {
    slackId = userField(usersRow, "Slack ID") || null;
    identId = userField(usersRow, "Hack Club ID") || null;
  }
  if (!slackId) slackId = await slackLookupByEmail(email);

  const hackatimeId = slackId
    ? await hackatimeLookup(`/api/v1/users/lookup_slack_uid/${encodeURIComponent(slackId)}`)
    : await hackatimeLookup(`/api/v1/users/lookup_email/${encodeURIComponent(email)}`);

  return {
    authorId: slackId ?? identId,
    ...(hackatimeId ? { hackatimeId } : {}),
  };
}

/**
 * Best-effort actor resolution for a submission's author email.
 * `fallbackRecordId` seeds a deterministic, protocol-shape-valid placeholder id
 * when nothing resolves; Sidekick renders it as an unknown user.
 */
export async function resolveActor(
  email: string,
  fallbackRecordId: string,
): Promise<ResolvedActor> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { authorId: `${UNRESOLVED_PREFIX}${fallbackRecordId}` };
  const resolution = await resolutionCache.get(normalized, () => resolve(normalized));
  return {
    authorId: resolution.authorId ?? `${UNRESOLVED_PREFIX}${fallbackRecordId}`,
    ...(resolution.hackatimeId ? { hackatimeId: resolution.hackatimeId } : {}),
  };
}

/**
 * Reverse lookup for FETCH_AUTHOR_PROJECTS: actor id -> author email.
 * Handles our unresolved-placeholder ids by returning the embedded record id instead.
 */
export async function emailForActorId(
  actorId: string,
): Promise<{ email?: string; recordId?: string }> {
  if (actorId.startsWith(UNRESOLVED_PREFIX)) {
    return { recordId: actorId.slice(UNRESOLVED_PREFIX.length) };
  }
  const users = await usersCache.get();
  const row = users.find(
    (r) => userField(r, "Slack ID") === actorId || userField(r, "Hack Club ID") === actorId,
  );
  const email = row ? userField(row, "Email").toLowerCase() : "";
  return email ? { email } : {};
}
