import { describe, expect, test } from "bun:test";
import { buildGroups, claimedHours, deriveStatus, groupToProject } from "../src/grouping";
import { makeRecord } from "./fixtures";

describe("buildGroups", () => {
  test("each record is its own project, never merged", () => {
    const a = makeRecord({ "Code URL": "https://github.com/user/repo" });
    const b = makeRecord({ "Code URL": "github.com/User/Repo/" }); // same repo, still separate
    const c = makeRecord({ "Code URL": "" });
    const groups = buildGroups([a, b, c]);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.members.length === 1)).toBe(true);
    expect(groups.map((g) => g.primary.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe("deriveStatus", () => {
  const group = (fields: Record<string, unknown>) => {
    const record = makeRecord({ "Code URL": "u", ...fields });
    return { key: record.id, primary: record, members: [record] };
  };

  test("pending when Status is unset", () => {
    expect(deriveStatus(group({}))).toBe("pending");
  });

  test("approved when Status is Approved", () => {
    expect(deriveStatus(group({ Status: "Approved" }))).toBe("approved");
  });

  test("rejected when Status is Rejected", () => {
    expect(deriveStatus(group({ Status: "Rejected" }))).toBe("rejected");
  });

  test("pending when Status is Pending", () => {
    expect(deriveStatus(group({ Status: "Pending" }))).toBe("pending");
  });
});

describe("claimedHours", () => {
  const group = (fields: Record<string, unknown>) => {
    const record = makeRecord(fields);
    return { key: record.id, primary: record, members: [record] };
  };

  test("returns the record's Original Hours", () => {
    expect(claimedHours(group({ "Original Hours": 10 }))).toBe(10);
  });

  test("0 when the record has no hours", () => {
    expect(claimedHours(group({}))).toBe(0);
  });
});

describe("groupToProject", () => {
  const actor = { authorId: "U05ABCDEF", hackatimeId: "42" };

  test("maps fields, hours, and hackatime key", () => {
    const a = makeRecord({
      "Code URL": "https://github.com/user/repo",
      "Playable URL": "https://demo.example.com",
      "Project Name": "Comet Chat",
      Description: "A chat app.",
      "Original Hours": 10,
      "Hackatime Project Name": "comet",
      Screenshot: [{ url: "https://cdn.example.com/shot.png" }],
    });
    const group = buildGroups([a])[0]!;
    const project = groupToProject(group, actor);

    expect(project.id).toBe(a.id);
    expect(project.title).toBe("Comet Chat");
    expect(project.codeUrl).toBe("https://github.com/user/repo");
    expect(project.demoUrl).toBe("https://demo.example.com");
    expect(project.screenshotUrl).toBe("https://cdn.example.com/shot.png");
    expect(project.authorId).toBe("U05ABCDEF");
    expect(project.hackatimeId).toBe("42");
    expect(project.hackatimeProjectKeys).toEqual(["comet"]);
    expect(project.description).toContain("A chat app.");
    expect(project.description).toContain("Author originally logged 10 hours.");
    expect(project.ships).toHaveLength(1);
    expect(project.ships[0]).toMatchObject({ id: a.id, hoursSubmitted: 10, status: "pending" });
    expect(project.metadata).toEqual({ recordIds: [a.id], memberCount: 1 });
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
