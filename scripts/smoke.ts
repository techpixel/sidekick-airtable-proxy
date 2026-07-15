/**
 * Smoke test: fires every Sidekick action at a running proxy.
 *
 *   bun scripts/smoke.ts http://localhost:3000 [--write --ship <recordId>]
 *
 * Read-only by default. --write additionally posts an internal comment to the
 * given ship and verifies it appears in the timeline (no record field writes).
 */

export {}; // top-level await requires module context

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const write = process.argv.includes("--write");
const shipArgIndex = process.argv.indexOf("--ship");
const writeShipId = shipArgIndex !== -1 ? process.argv[shipArgIndex + 1] : undefined;
const secret = process.env.SIDEKICK_SECRET;

if (!secret) {
  console.error("Set SIDEKICK_SECRET in the environment.");
  process.exit(1);
}

let failures = 0;

function report(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function call(
  action: string,
  input: unknown = {},
  auth: string | null = `Bearer ${secret}`,
): Promise<{ status: number; body: any }> {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify({ action, input }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

// --- Auth ---
{
  const bad = await call("HEALTH_CHECK", {}, "Bearer wrong-secret");
  report("rejects bad secret with 401", bad.status === 401 && bad.body?.error === "UNAUTHORIZED");
}

// --- Health & stats ---
{
  const health = await call("HEALTH_CHECK");
  report("HEALTH_CHECK", health.status === 200 && health.body?.ok === true);

  const stats = await call("GET_PROGRAM_STATS");
  report(
    "GET_PROGRAM_STATS",
    stats.status === 200 &&
      typeof stats.body?.pendingReviewCount === "number" &&
      stats.body?.pendingHqCount === 0 &&
      stats.body?.pendingFulfillmentCount === 0,
    `pendingReviewCount=${stats.body?.pendingReviewCount}`,
  );
}

// --- FETCH_PROJECTS full cursor walk ---
let firstProjectId: string | undefined;
{
  const seen = new Set<string>();
  let cursor: string | undefined;
  let totalCount = -1;
  let pages = 0;
  for (;;) {
    const page = await call("FETCH_PROJECTS", { status: "all", limit: 50, cursor });
    if (page.status !== 200) {
      report("FETCH_PROJECTS cursor walk", false, `HTTP ${page.status}`);
      break;
    }
    totalCount = page.body.totalCount;
    for (const project of page.body.projects) {
      if (seen.has(project.id)) report("no duplicate project ids", false, project.id);
      seen.add(project.id);
      firstProjectId ??= project.id;
    }
    pages++;
    if (!page.body.nextCursor) {
      report(
        "FETCH_PROJECTS cursor walk",
        seen.size === totalCount,
        `${seen.size} projects over ${pages} page(s), totalCount=${totalCount}`,
      );
      break;
    }
    cursor = page.body.nextCursor;
  }

  const badCursor = await call("FETCH_PROJECTS", { cursor: "garbage" });
  report("rejects garbage cursor", badCursor.status === 400);
}

// --- Detail, timeline, author projects on the first project ---
if (firstProjectId) {
  const detail = await call("FETCH_PROJECT_DETAIL", { projectId: firstProjectId });
  report(
    "FETCH_PROJECT_DETAIL",
    detail.status === 200 && detail.body?.id === firstProjectId && detail.body?.ships?.length === 1,
    detail.body?.title,
  );

  const timeline = await call("FETCH_PROJECT_TIMELINE", { projectId: firstProjectId });
  const hasShipEvent = timeline.body?.events?.some((e: any) => e.type === "ship");
  report(
    "FETCH_PROJECT_TIMELINE",
    timeline.status === 200 && hasShipEvent,
    `${timeline.body?.events?.length} event(s)`,
  );

  const author = await call("FETCH_AUTHOR_PROJECTS", {
    authorId: detail.body?.authorId,
    excludeProjectId: firstProjectId,
  });
  report(
    "FETCH_AUTHOR_PROJECTS",
    author.status === 200 && Array.isArray(author.body?.projects),
    `${author.body?.projects?.length} sibling project(s)`,
  );
} else {
  console.log("SKIP  detail/timeline/author checks — base has no projects");
}

// --- Not-found paths ---
{
  const missing = await call("FETCH_PROJECT_DETAIL", { projectId: "recDoesNotExist000" });
  report("404 for unknown project", missing.status === 404 && missing.body?.error === "NOT_FOUND");
}

// --- Stubs ---
{
  const items = await call("FETCH_SHOP_ITEMS");
  report("FETCH_SHOP_ITEMS empty", items.status === 200 && items.body?.items?.length === 0);

  const orders = await call("FETCH_ORDERS");
  report(
    "FETCH_ORDERS empty",
    orders.status === 200 && orders.body?.orders?.length === 0 && orders.body?.totalCount === 0,
  );

  for (const action of [
    "FETCH_ORDER_DETAIL",
    "REVEAL_ORDER_ADDRESS",
    "UPDATE_ORDER_STATUS",
    "UPDATE_ORDER_FIELDS",
    "UPDATE_ITEM_FIELDS",
  ]) {
    const result = await call(action, { orderId: "order_x", itemId: "item_x" });
    report(`${action} -> 404`, result.status === 404);
  }

  for (const action of ["FETCH_USER_NOTE", "UPDATE_USER_NOTE"]) {
    const result = await call(action, { userId: "U000", note: null, editorId: "U000" });
    report(
      `${action} -> INVALID_ACTION`,
      result.status === 400 && result.body?.error === "INVALID_ACTION",
    );
  }

  const unknown = await call("SOME_FUTURE_ACTION");
  report(
    "unknown action -> 400 INVALID_ACTION",
    unknown.status === 400 && unknown.body?.error === "INVALID_ACTION",
  );

  const authorize = await call("SUBMIT_REVIEW_ACTION", {
    shipId: firstProjectId ?? "recDoesNotExist000",
    reviewerId: "ident!smoke",
    action: "authorize",
  });
  report(
    "authorize -> 400 (single-stage)",
    authorize.status === (firstProjectId ? 400 : 404),
  );
}

// --- Optional write flow ---
if (write) {
  const shipId = writeShipId ?? firstProjectId;
  if (!shipId) {
    report("write flow", false, "no ship id available");
  } else {
    const marker = `smoke test ${Date.now()}`;
    const posted = await call("SUBMIT_REVIEW_ACTION", {
      shipId,
      reviewerId: "ident!smoke",
      action: "internal_comment",
      commentText: marker,
    });
    report(
      "internal_comment accepted",
      posted.status === 200 && posted.body?.event?.type === "comment",
    );

    const timeline = await call("FETCH_PROJECT_TIMELINE", { projectId: shipId });
    const found = timeline.body?.events?.some(
      (e: any) => e.type === "comment" && e.message === marker && e.isInternal === true,
    );
    report("comment visible in timeline", Boolean(found));
  }
} else {
  console.log("SKIP  write flow (pass --write [--ship recXXX] to enable)");
}

console.log(failures === 0 ? "\nAll smoke checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
