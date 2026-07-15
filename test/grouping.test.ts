import { describe, expect, test } from "bun:test";
import {
  averageHours,
  buildGroups,
  deriveStatus,
  groupToProject,
  normalizeCodeUrl,
} from "../src/grouping";
import { makeRecord } from "./fixtures";

describe("normalizeCodeUrl", () => {
  const cases: [string, string | null][] = [
    ["", null],
    ["   ", null],
    ["https://github.com/User/Repo", "github.com/user/repo"],
    ["http://github.com/user/repo", "github.com/user/repo"],
    ["https://www.github.com/user/repo", "github.com/user/repo"],
    ["github.com/user/repo", "github.com/user/repo"],
    ["https://github.com/user/repo/", "github.com/user/repo"],
    ["https://github.com/user/repo.git", "github.com/user/repo"],
    ["https://github.com/user/repo?tab=readme#top", "github.com/user/repo"],
    ["https://GITHUB.COM/user/repo", "github.com/user/repo"],
    ["not a url at all", "not a url at all"],
  ];
  for (const [input, expected] of cases) {
    test(JSON.stringify(input), () => {
      expect(normalizeCodeUrl(input)).toBe(expected);
    });
  }
});

describe("buildGroups", () => {
  test("merges records sharing a normalized Code URL", () => {
    const a = makeRecord(
      { "Code URL": "https://github.com/user/repo" },
      { createdTime: "2026-07-01T00:00:00.000Z" },
    );
    const b = makeRecord(
      { "Code URL": "github.com/User/Repo/" },
      { createdTime: "2026-07-02T00:00:00.000Z" },
    );
    const c = makeRecord({ "Code URL": "https://github.com/other/thing" });
    const groups = buildGroups([b, a, c]);
    expect(groups).toHaveLength(2);
    const merged = groups.find((g) => g.members.length === 2)!;
    expect(merged.primary.id).toBe(a.id); // earliest record is primary
  });

  test("records without a Code URL are solo projects", () => {
    const a = makeRecord({ "Code URL": "" });
    const b = makeRecord({});
    const groups = buildGroups([a, b]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.members.length === 1)).toBe(true);
  });

  test("primary uses Automation - First Submitted At over createdTime", () => {
    const late = makeRecord(
      {
        "Code URL": "https://github.com/x/y",
        "Automation - First Submitted At": "2026-06-01T00:00:00.000Z",
      },
      { createdTime: "2026-07-05T00:00:00.000Z" },
    );
    const early = makeRecord(
      { "Code URL": "https://github.com/x/y" },
      { createdTime: "2026-07-01T00:00:00.000Z" },
    );
    const groups = buildGroups([early, late]);
    expect(groups[0]!.primary.id).toBe(late.id);
  });
});

describe("deriveStatus", () => {
  const record = (fields: Record<string, unknown>) => makeRecord({ "Code URL": "u", ...fields });

  test("pending when no checkbox is set", () => {
    expect(deriveStatus({ key: "u", primary: record({}), members: [record({})] })).toBe("pending");
  });

  test("approved when any member is submitted to unified", () => {
    const members = [record({}), record({ "Automation - Submit to Unified YSWS": true })];
    expect(deriveStatus({ key: "u", primary: members[0]!, members })).toBe("approved");
  });

  test("rejected when any member is rejected and none approved", () => {
    const members = [record({}), record({ Rejected: true })];
    expect(deriveStatus({ key: "u", primary: members[0]!, members })).toBe("rejected");
  });

  test("approved wins when both checkboxes are ticked", () => {
    const members = [record({ "Automation - Submit to Unified YSWS": true, Rejected: true })];
    expect(deriveStatus({ key: "u", primary: members[0]!, members })).toBe("approved");
  });
});

describe("averageHours", () => {
  test("averages members that have Original Hours, skipping the rest", () => {
    const members = [
      makeRecord({ "Original Hours": 10 }),
      makeRecord({ "Original Hours": 5 }),
      makeRecord({}),
    ];
    expect(averageHours({ key: "u", primary: members[0]!, members })).toBe(7.5);
  });

  test("0 when no member has hours", () => {
    const members = [makeRecord({})];
    expect(averageHours({ key: "u", primary: members[0]!, members })).toBe(0);
  });

  test("rounds to 2 decimal places", () => {
    const members = [makeRecord({ "Original Hours": 1 }), makeRecord({ "Original Hours": 2 })];
    expect(averageHours({ key: "u", primary: members[0]!, members })).toBe(1.5);
  });
});

describe("groupToProject", () => {
  const actor = { authorId: "U05ABCDEF", hackatimeId: "42" };

  test("maps fields, merged hours, and hackatime keys", () => {
    const a = makeRecord(
      {
        "Code URL": "https://github.com/user/repo",
        "Playable URL": "https://demo.example.com",
        "Project Name": "Comet Chat",
        Description: "A chat app.",
        "Original Hours": 10,
        "Hackatime Project Name": "comet",
        Screenshot: [{ url: "https://cdn.example.com/shot.png" }],
      },
      { createdTime: "2026-07-01T00:00:00.000Z" },
    );
    const b = makeRecord(
      {
        "Code URL": "https://github.com/user/repo/",
        "Original Hours": 20,
        "Hackatime Project Name": "comet-v2",
      },
      { createdTime: "2026-07-02T00:00:00.000Z" },
    );
    const group = buildGroups([a, b])[0]!;
    const project = groupToProject(group, actor);

    expect(project.id).toBe(a.id);
    expect(project.title).toBe("Comet Chat");
    expect(project.codeUrl).toBe("https://github.com/user/repo");
    expect(project.demoUrl).toBe("https://demo.example.com");
    expect(project.screenshotUrl).toBe("https://cdn.example.com/shot.png");
    expect(project.authorId).toBe("U05ABCDEF");
    expect(project.hackatimeId).toBe("42");
    expect(project.hackatimeProjectKeys).toEqual(["comet", "comet-v2"]);
    expect(project.description).toContain("A chat app.");
    expect(project.description).toContain("Author originally logged 15 hours.");
    expect(project.description).toContain("average of 2 merged submissions");
    expect(project.ships).toHaveLength(1);
    expect(project.ships[0]).toMatchObject({ id: a.id, hoursSubmitted: 15, status: "pending" });
    expect(project.metadata).toEqual({ recordIds: [a.id, b.id], memberCount: 2 });
  });

  test("title falls back to repo name, then a placeholder", () => {
    const withUrl = makeRecord({ "Code URL": "https://github.com/user/my-repo" });
    const withUrlGroup = buildGroups([withUrl])[0]!;
    expect(groupToProject(withUrlGroup, actor).title).toBe("my-repo");

    const bare = makeRecord({});
    const bareGroup = buildGroups([bare])[0]!;
    expect(groupToProject(bareGroup, actor).title).toBe(`Untitled project (${bare.id})`);
  });

  test("description is just the epilogue when Description is empty", () => {
    const record = makeRecord({ "Code URL": "https://github.com/a/b", "Original Hours": 3 });
    const group = buildGroups([record])[0]!;
    expect(groupToProject(group, actor).description).toBe("Author originally logged 3 hours.");
  });
});
