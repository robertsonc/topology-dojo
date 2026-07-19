# Game-Day Evidence Record — TEMPLATE

_Copy this file for each drill (suggested location: the private operator
record, or `docs/game-days/GD-<date>-<n>.md` if committing — a committed
record must contain **no secrets, tokens, cookie values, or private user
data**; run links, SHAs, timestamps, and statuses only)._

## Drill identity

| Field                    | Value                                           |
| ------------------------ | ----------------------------------------------- |
| Game-day identifier      | GD-YYYY-MM-DD-n                                 |
| Date                     |                                                 |
| Start time (UTC)         |                                                 |
| End time (UTC)           |                                                 |
| Operator(s)              |                                                 |
| Observer(s)              | (may be "operator, dual-hatted" on a solo team) |
| Environment(s) exercised | staging / staging+production-safe               |
| Plan version             | `docs/GAME_DAY.md` @ commit `<sha>`             |

## Starting state (Phase 1)

| Field                                    | Value                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Production SHA (`/healthz`)              |                                                                                       |
| Production SHA matches last deploy run   | yes/no — run link:                                                                    |
| Staging SHA (`/healthz`)                 |                                                                                       |
| Feature flags — production (3 values)    |                                                                                       |
| Feature flags — staging (3 values)       |                                                                                       |
| Durable Object migration state           | highest tag `v5` expected — confirmed yes/no                                          |
| Pending migrations in flight             | none expected — confirmed yes/no                                                      |
| Open smoke issues at start               |                                                                                       |
| Notification path state (L1 / L3)        | e.g. "L1 only — CF-3 not yet configured"                                              |
| Cloudflare policy scoping notes          | which policies are account-wide vs scoped; paused-for-drill list + un-pause timer set |
| `DIAGNOSTICS_TOKEN` present in staging   | yes/no (value **never** recorded here)                                                |
| Stop conditions reviewed                 | yes/no                                                                                |
| Pre-listed staging-degrading steps       | S-1..S-12 subset:                                                                     |
| Production steps pre-authorized by owner | P-4..P-10 subset:                                                                     |

## Scenario log

One row per executed scenario (S-0…S-12, P-1…P-12). "Alert received" names
the concrete artifact (GitHub issue #/comment link, Cloudflare email
subject) or "none expected"/"MISSED".

| #   | Scenario | Expected result | Actual result | Pass/Fail | Alert received (artifact) | Notification destination | Time to detection | Time to acknowledgement | Time to recovery | Deployment / workflow run link | Screenshots / external evidence ref |
| --- | -------- | --------------- | ------------- | --------- | ------------------------- | ------------------------ | ----------------- | ----------------------- | ---------------- | ------------------------------ | ----------------------------------- |
|     |          |                 |               |           |                           |                          |                   |                         |                  |                                |                                     |

## Timing summary

| Measure                                      | Value |
| -------------------------------------------- | ----- |
| Fastest / slowest time-to-detection observed |       |
| Forward disable→restore wall-clock per flag  |       |
| Approval-gate latency (dispatch → approval)  |       |
| False positives (count + which)              |       |
| Missed alerts (count + which)                |       |

## Findings

| #   | Finding | Severity (SEV-1/2/3 if it had been real) | Follow-up issue / PR |
| --- | ------- | ---------------------------------------- | -------------------- |
|     |         |                                          |                      |

## Close-out

| Field                                        | Value              |
| -------------------------------------------- | ------------------ |
| Staging restored to config state (S-12)      | yes/no — run link: |
| Production restored to intended flags (P-12) | yes/no — run link: |
| Paused alert policies un-paused              | yes/no/n-a         |
| Open smoke issues at end                     |                    |
| Threshold updates filed (`ALERTS.md` PR)     |                    |
| Runbook corrections filed                    |                    |
| Overall pass/fail                            |                    |
| Operator sign-off (name + date)              |                    |
