# sidekick-airtable-proxy

The [Sidekick](https://github.com/ascpixi/sidekick) master endpoint for the **YSWS - Horizons Nexus** Airtable base. Sidekick sends every request as a `POST` with `{"action": "...", "input": {...}}`; this proxy translates those actions into reads and writes against the base.

## How it maps onto the base

The proxy adds **zero fields** to the base. Everything is derived from or written to existing fields:

| Sidekick concept | Airtable |
| --- | --- |
| Project / ship (always 1:1) | One record in `YSWS Project Submission` (one record = one project; never merged) |
| Ship status | `Status` single-select: `Approved` → `approved`; `Rejected` → `rejected`; else `pending` |
| Claimed hours (`hoursSubmitted`) | `Original Hours` |
| Assigned hours on approve | `Optional - Override Hours Spent` |
| Reviewer justification | `Justification` |
| Approve | Sets `Status` = `Approved` |
| Reject | Sets `Status` = `Rejected` |
| Review events (approvals, rejections, comments) | Record comments on the record, `[sidekick:v1] {json}` |
| Author identity | `Email` → `Users` table (`Slack ID` / `Hack Club ID`) → Slack API fallback |
| Hackatime id | Hackatime `lookup_slack_uid` / `lookup_email` (needs `STATS_API_KEY`) |
| `hackatimeProjectKeys` | `Hackatime Project Name` |

### One record per project

Every submission record is presented as its own project, even when records share a Code URL — records are never merged (they carry distinct Hackatime projects, hours, and authors). The record id is the project & ship id, and its comments hold the event log.

### Manual edits in Airtable

Status is re-derived from the `Status` single-select on every read, so setting it to `Approved` or `Rejected` by hand works — the timeline synthesizes a matching approval/rejection event (attributed to `ident!airtable`) when no Sidekick-created event exists.

## Protocol deviations (by design)

- **No public feedback.** `feedbackMessage` is never persisted; events echo the constant `"(none)"`. Only the internal justification is kept. `UPDATE_REVIEW_ACTION.feedbackMessage` is accepted and discarded.
- **Single-stage review.** `pending_hq` never occurs; `authorize`/`deauthorize` and `hoursAssigned` edits via `UPDATE_REVIEW_ACTION` return 400. `supportsRewardedOverride` is not advertised and `rewardedHoursOverride` is rejected.
- **Re-approving an approved ship is a 400.** Rejecting an approved ship is also a 400. Approving a rejected ship is allowed (flips `Status` to `Approved`).
- **No shop.** `FETCH_SHOP_ITEMS`/`FETCH_ORDERS` return empty; order/item lookups 404. User notes return `INVALID_ACTION` (Sidekick hides the UI).
- **Unresolvable authors** get a placeholder `ident!unresolved_<recordId>` id; Sidekick renders them as unknown users.
- **Screenshot URLs expire** (~2 h, an Airtable attachment property). The 60 s record cache keeps served URLs fresh, but don't persist them.

## Running

```sh
cp .env.example .env   # fill in SIDEKICK_SECRET + AIRTABLE_API_KEY at minimum
bun run start          # or: bun run dev
```

Docker:

```sh
docker build -t sidekick-airtable-proxy .
docker run --env-file .env -p 3000:3000 sidekick-airtable-proxy
```

Point Sidekick's program endpoint at the deployed URL (any path works; `GET /healthz` is for orchestration probes).

## Testing

```sh
bun test                                  # pure-logic unit tests, no network
bun scripts/smoke.ts http://localhost:3000              # read-only, fires every action
bun scripts/smoke.ts http://localhost:3000 --write --ship recXXXXXXXXXXXXXX
```

The `--write` flow only posts an internal comment (no record field writes). `SIDEKICK_SECRET` must be set in the environment for the smoke script.
