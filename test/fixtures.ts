import type { RecordComment, SubmissionRecord } from "../src/types";

let counter = 0;

export function makeRecord(
  fields: Record<string, unknown>,
  overrides: Partial<Pick<SubmissionRecord, "id" | "createdTime">> = {},
): SubmissionRecord {
  counter++;
  return {
    id: overrides.id ?? `rec${String(counter).padStart(14, "0")}`,
    createdTime: overrides.createdTime ?? `2026-07-0${(counter % 9) + 1}T10:00:00.000Z`,
    fields,
  };
}

export function makeComment(text: string, createdTime = "2026-07-10T12:00:00.000Z"): RecordComment {
  counter++;
  return { id: `com${String(counter).padStart(14, "0")}`, text, createdTime };
}
