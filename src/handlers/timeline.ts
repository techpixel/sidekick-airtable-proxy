import { listComments, submissionsCache } from "../airtable";
import { resolveActor } from "../actors";
import { notFound } from "../errors";
import { buildTimeline } from "../events";
import { buildGroups, findGroupByRecordId } from "../grouping";
import { F, fieldString, reqString } from "../types";

export async function fetchProjectTimeline(input: Record<string, unknown>): Promise<unknown> {
  const projectId = reqString(input, "projectId");
  const group = findGroupByRecordId(buildGroups(await submissionsCache.get()), projectId);
  if (!group) throw notFound(`No project found with ID ${projectId}.`);

  const [actor, comments] = await Promise.all([
    resolveActor(fieldString(group.primary, F.email), group.primary.id),
    listComments(group.primary.id),
  ]);
  return { events: buildTimeline(group, actor, comments) };
}
