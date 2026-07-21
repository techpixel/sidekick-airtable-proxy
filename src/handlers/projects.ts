import { submissionsCache } from "../airtable";
import { emailForActorId, resolveActor } from "../actors";
import { badRequest, notFound } from "../errors";
import {
  buildGroups,
  clampLimit,
  decodeCursor,
  deriveStatus,
  encodeCursor,
  findGroupByRecordId,
  groupToProject,
  pageAfter,
  sortGroups,
} from "../grouping";
import { F, fieldString, optNumber, optString, reqString, type Project, type ProjectGroup } from "../types";

const STATUS_FILTERS = ["pending", "pending_hq", "approved", "rejected", "all"] as const;

async function loadGroups(): Promise<ProjectGroup[]> {
  return buildGroups(await submissionsCache.get());
}

async function toProject(group: ProjectGroup): Promise<Project> {
  const email = fieldString(group.primary, F.email);
  const actor = await resolveActor(email, group.primary.id);
  return groupToProject(group, actor);
}

/** Resolve actors for a page of groups with bounded concurrency. */
async function toProjects(groups: ProjectGroup[]): Promise<Project[]> {
  const projects: Project[] = new Array(groups.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(5, groups.length) }, async () => {
      while (next < groups.length) {
        const index = next++;
        projects[index] = await toProject(groups[index]!);
      }
    }),
  );
  return projects;
}

export async function fetchProjects(input: Record<string, unknown>): Promise<unknown> {
  const status = optString(input, "status") ?? "all";
  if (!STATUS_FILTERS.includes(status as (typeof STATUS_FILTERS)[number])) {
    throw badRequest(`Invalid status filter: ${status}`);
  }
  const limit = clampLimit(optNumber(input, "limit"));
  const cursor = optString(input, "cursor");

  const groups = await loadGroups();
  const filtered =
    status === "all" ? groups : groups.filter((group) => deriveStatus(group) === status);
  const sorted = sortGroups(filtered);

  const anchor = cursor ? decodeCursor(cursor, status) : null;
  const { page, hasMore } = pageAfter(sorted, anchor, limit);

  const projects = await toProjects(page.map((entry) => entry.group));
  const last = page[page.length - 1];
  return {
    projects,
    ...(hasMore && last ? { nextCursor: encodeCursor(status, last.sortKey) } : {}),
    totalCount: sorted.length,
    // Pages are alphabetical by title; Sidekick must not re-sort by ship date.
    explicitlySorted: true,
  };
}

export async function fetchProjectDetail(input: Record<string, unknown>): Promise<unknown> {
  const projectId = reqString(input, "projectId");
  const group = findGroupByRecordId(await loadGroups(), projectId);
  if (!group) throw notFound(`No project found with ID ${projectId}.`);
  return toProject(group);
}

export async function fetchAuthorProjects(input: Record<string, unknown>): Promise<unknown> {
  const authorId = reqString(input, "authorId");
  const excludeProjectId = optString(input, "excludeProjectId");

  const { email, recordId } = await emailForActorId(authorId);
  if (!email && !recordId) return { projects: [] };

  const groups = await loadGroups();
  const matching = groups.filter((group) => {
    if (group.primary.id === excludeProjectId) return false;
    if (recordId) return group.primary.id === recordId;
    return fieldString(group.primary, F.email).trim().toLowerCase() === email;
  });
  return { projects: await toProjects(matching) };
}

export async function getProgramStats(): Promise<unknown> {
  const groups = await loadGroups();
  return {
    pendingReviewCount: groups.filter((group) => deriveStatus(group) === "pending").length,
    pendingHqCount: 0,
    pendingFulfillmentCount: 0,
  };
}
