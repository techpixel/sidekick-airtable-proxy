import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/errors";
import {
  buildGroups,
  clampLimit,
  decodeCursor,
  encodeCursor,
  pageAfter,
  sortGroups,
} from "../src/grouping";
import { makeRecord } from "./fixtures";

function makeSorted(count: number) {
  const records = Array.from({ length: count }, (_, i) =>
    makeRecord(
      { "Code URL": `https://github.com/user/repo-${i}` },
      { createdTime: `2026-07-01T${String(i).padStart(2, "0")}:00:00.000Z` },
    ),
  );
  return sortGroups(buildGroups(records));
}

describe("cursor pagination", () => {
  test("round-trips through encode/decode", () => {
    const anchor: [string, string] = ["2026-07-01T00:00:00.000Z", "rec123"];
    expect(decodeCursor(encodeCursor("pending", anchor), "pending")).toEqual(anchor);
  });

  test("rejects a cursor issued for a different status filter", () => {
    const cursor = encodeCursor("pending", ["t", "r"]);
    expect(() => decodeCursor(cursor, "approved")).toThrow(ApiError);
  });

  test("rejects garbage cursors", () => {
    expect(() => decodeCursor("not-a-cursor", "all")).toThrow(ApiError);
  });

  test("walks all items exactly once", () => {
    const sorted = makeSorted(7);
    const seen: string[] = [];
    let anchor: [string, string] | null = null;
    for (;;) {
      const { page, hasMore } = pageAfter(sorted, anchor, 3);
      seen.push(...page.map((entry) => entry.group.primary.id));
      if (!hasMore) break;
      anchor = page[page.length - 1]!.sortKey;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  test("is stable when items are inserted mid-walk", () => {
    const sorted = makeSorted(6);
    const firstPage = pageAfter(sorted, null, 3);
    const anchor = firstPage.page[2]!.sortKey;

    // A new record submitted before the anchor must not shift later pages.
    const insert = sortGroups(
      buildGroups([
        makeRecord(
          { "Code URL": "https://github.com/new/early" },
          { createdTime: "2026-07-01T00:30:00.000Z" },
        ),
      ]),
    )[0]!;
    const grown = [...sorted.slice(0, 1), insert, ...sorted.slice(1)];

    const secondPage = pageAfter(grown, anchor, 3);
    const originalSecondPage = pageAfter(sorted, anchor, 3);
    expect(secondPage.page.map((e) => e.group.primary.id)).toEqual(
      originalSecondPage.page.map((e) => e.group.primary.id),
    );
  });

  test("clampLimit bounds and defaults", () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(1000)).toBe(100);
    expect(clampLimit(25.9)).toBe(25);
  });
});
