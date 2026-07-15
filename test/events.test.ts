import { describe, expect, test } from "bun:test";
import {
  buildTimeline,
  COMMENT_PREFIX,
  decodePayload,
  encodePayload,
  FALLBACK_REVIEWER_ID,
  NO_FEEDBACK,
  type ApprovalPayload,
} from "../src/events";
import { buildGroups } from "../src/grouping";
import { makeComment, makeRecord } from "./fixtures";

const actor = { authorId: "U05ABCDEF" };

describe("payload encode/decode", () => {
  test("round-trips an approval payload", () => {
    const payload: ApprovalPayload = {
      kind: "approval",
      shipId: "rec123",
      actorId: "ident!rev",
      hoursAssigned: 7.5,
      justification: "Verified.",
      at: "2026-07-10T12:00:00.000Z",
    };
    const text = encodePayload(payload);
    expect(text.startsWith(COMMENT_PREFIX)).toBe(true);
    expect(decodePayload(text)).toEqual(payload);
  });

  test("ignores human comments and malformed payloads", () => {
    expect(decodePayload("looks good to me!")).toBeNull();
    expect(decodePayload(`${COMMENT_PREFIX}{not json`)).toBeNull();
    expect(decodePayload(`${COMMENT_PREFIX}{"kind":"mystery"}`)).toBeNull();
  });

  test("truncates oversized justifications", () => {
    const payload: ApprovalPayload = {
      kind: "approval",
      shipId: "rec123",
      actorId: "ident!rev",
      hoursAssigned: 1,
      justification: "x".repeat(20_000),
      at: "2026-07-10T12:00:00.000Z",
    };
    const decoded = decodePayload(encodePayload(payload)) as ApprovalPayload;
    expect(decoded.justification.length).toBeLessThan(10_000);
    expect(decoded.justification.endsWith("…[truncated]")).toBe(true);
  });
});

describe("buildTimeline", () => {
  test("always includes the single ship event first", () => {
    const record = makeRecord(
      { "Code URL": "https://github.com/a/b", "Original Hours": 4 },
      { createdTime: "2026-07-01T00:00:00.000Z" },
    );
    const group = buildGroups([record])[0]!;
    const events = buildTimeline(group, actor, []);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "ship",
      shipId: record.id,
      actorId: "U05ABCDEF",
      hoursSubmitted: 4,
    });
  });

  test("decodes stored events and echoes feedback as the constant", () => {
    const record = makeRecord({ "Code URL": "https://github.com/a/b" });
    const group = buildGroups([record])[0]!;
    const approval = encodePayload({
      kind: "approval",
      shipId: record.id,
      actorId: "ident!rev",
      hoursAssigned: 3,
      justification: "ok",
      at: "2026-07-11T00:00:00.000Z",
    });
    const comment = encodePayload({
      kind: "comment",
      actorId: "ident!rev",
      message: "hi",
      isInternal: true,
      at: "2026-07-12T00:00:00.000Z",
    });
    const events = buildTimeline(group, actor, [makeComment(approval), makeComment(comment)]);
    expect(events.map((e) => e.type)).toEqual(["ship", "approval", "comment"]);
    expect(events[1]).toMatchObject({ feedbackMessage: NO_FEEDBACK, justification: "ok" });
    expect(events[2]).toMatchObject({ message: "hi", isInternal: true });
  });

  test("synthesizes an approval for records approved by hand in Airtable", () => {
    const record = makeRecord({
      "Code URL": "https://github.com/a/b",
      "Automation - Submit to Unified YSWS": true,
      "Optional - Override Hours Spent": 9,
      "Optional - Override Hours Spent Justification": "manual",
    });
    const group = buildGroups([record])[0]!;
    const events = buildTimeline(group, actor, []);
    expect(events.map((e) => e.type)).toEqual(["ship", "approval"]);
    expect(events[1]).toMatchObject({
      actorId: FALLBACK_REVIEWER_ID,
      hoursAssigned: 9,
      justification: "manual",
    });
  });

  test("synthesizes a rejection for records rejected by hand", () => {
    const record = makeRecord({ "Code URL": "https://github.com/a/b", Rejected: true });
    const group = buildGroups([record])[0]!;
    const events = buildTimeline(group, actor, []);
    expect(events.map((e) => e.type)).toEqual(["ship", "rejection"]);
    expect(events[1]).toMatchObject({ actorId: FALLBACK_REVIEWER_ID });
  });

  test("does not synthesize when a stored decision event exists", () => {
    const record = makeRecord({
      "Code URL": "https://github.com/a/b",
      "Automation - Submit to Unified YSWS": true,
    });
    const group = buildGroups([record])[0]!;
    const stored = encodePayload({
      kind: "approval",
      shipId: record.id,
      actorId: "ident!rev",
      hoursAssigned: 2,
      justification: "real",
      at: "2026-07-11T00:00:00.000Z",
    });
    const events = buildTimeline(group, actor, [makeComment(stored)]);
    const approvals = events.filter((e) => e.type === "approval");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ actorId: "ident!rev" });
  });

  test("sorts events chronologically", () => {
    const record = makeRecord(
      { "Code URL": "https://github.com/a/b" },
      { createdTime: "2026-07-05T00:00:00.000Z" },
    );
    const group = buildGroups([record])[0]!;
    const early = encodePayload({
      kind: "comment",
      actorId: "ident!rev",
      message: "first",
      isInternal: false,
      at: "2026-07-06T00:00:00.000Z",
    });
    const late = encodePayload({
      kind: "comment",
      actorId: "ident!rev",
      message: "second",
      isInternal: false,
      at: "2026-07-08T00:00:00.000Z",
    });
    const events = buildTimeline(group, actor, [makeComment(late), makeComment(early)]);
    expect(events.map((e) => (e.type === "comment" ? e.message : e.type))).toEqual([
      "ship",
      "first",
      "second",
    ]);
  });
});
