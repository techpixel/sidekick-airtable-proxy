# sidekick-airtable-proxy

The [Sidekick](https://github.com/ascpixi/sidekick) master endpoint for the **YSWS - Horizons Nexus** Airtable base. Sidekick sends every request as a `POST` with `{"action": "...", "input": {...}}`; this proxy translates those actions into reads and writes against the base.

## How it maps onto the base

The proxy adds **zero fields** to the base. Everything is derived from or written to existing fields:

| Sidekick concept | Airtable |
| --- | --- |
| Project / ship (always 1:1) | One record in `YSWS Project Submission` (merged groups: see below) |
| Ship status | `Automation - Submit to Unified YSWS` ✓ → `approved`; else `Rejected` ✓ → `rejected`; else `pending` |
| Claimed hours (`hoursSubmitted`) | `Original Hours` (averaged across merged records) |
| Assigned hours on approve | `Optional - Override Hours Spent` |
| Reviewer justification | `Optional - Override Hours Spent Justification` |
| Approve | Ticks `Automation - Submit to Unified YSWS` (fires the Unified YSWS automation), clears `Rejected` |
| Reject | Ticks `Rejected` |
| Review events (approvals, rejections, comments) | Record comments on the primary record, `[sidekick:v1] {json}` |
| Author identity | `Email` → `Users` table (`Slack ID` / `Hack Club ID`) → Slack API fallback |
| Hackatime id | Hackatime `lookup_slack_uid` / `lookup_email` (needs `STATS_API_KEY`) |
| `hackatimeProjectKeys` | `Hackatime Project Name` (union across merged records) |

### Merged records

Records sharing the same normalized Code URL (scheme/`www.`/case/trailing-`/`/`.git`/query ignored) are presented as **one project**. The earliest record is the *primary*: its title, description, author, and screenshot are used, its record id is the project & ship id, and its comments hold the event log. Hours are the average of the group's `Original Hours`. Approve/reject writes apply to **every** record in the group (each row flows to Unified YSWS independently). All member record ids are listed in `project.metadata.recordIds`.

### Manual edits in Airtable

Status is re-derived from the checkboxes on every read, so ticking `Automation - Submit to Unified YSWS` or `Rejected` by hand works — the timeline synthesizes a matching approval/rejection event (attributed to `ident!airtable`) when no Sidekick-created event exists.

## Protocol deviations (by design)

- **No public feedback.** `feedbackMessage` is never persisted; events echo the constant `"(none)"`. Only the internal justification is kept. `UPDATE_REVIEW_ACTION.feedbackMessage` is accepted and discarded.
- **Single-stage review.** `pending_hq` never occurs; `authorize`/`deauthorize` and `hoursAssigned` edits via `UPDATE_REVIEW_ACTION` return 400. `supportsRewardedOverride` is not advertised and `rewardedHoursOverride` is rejected.
- **Re-approving an approved ship is a 400** — the Unified YSWS automation already fired and can't be re-run safely. Rejecting an approved ship is also a 400. Approving a rejected ship is allowed (clears `Rejected`).
- **No shop.** `FETCH_SHOP_ITEMS`/`FETCH_ORDERS` return empty; order/item lookups 404. User notes return `INVALID_ACTION` (Sidekick hides the UI).
- **Unresolvable authors** get a placeholder `ident!unresolved_<recordId>` id; Sidekick renders them as unknown users.
- **Merged co-authors are invisible** (the protocol allows one `authorId`); see `metadata.recordIds` and the description epilogue for the full picture.
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
