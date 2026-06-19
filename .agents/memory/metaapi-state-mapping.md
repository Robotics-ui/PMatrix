---
name: MetaApi state mapping
description: Canonical mapMetaApiState function location, correct state mappings, and frontend SETTLED_STATUSES set.
---

## Rule
`mapMetaApiState` is defined once in `artifacts/api-server/src/lib/metaapi.ts` and exported. Import it from there in any route or worker — never duplicate it.

## Correct mapping (MetaApi raw → internal status)
| MetaApi state | Internal status |
|---|---|
| DEPLOYING | deploying |
| DEPLOYED  | deploying (not yet connecting) |
| CONNECTING | connecting |
| SYNCHRONIZING | synchronizing |
| CONNECTED | connected |
| DISCONNECTING | disconnected |
| DISCONNECTED | disconnected |
| UNDEPLOYING | disconnected |
| FAILED | failed |
| ERROR | failed |
| (anything else) | connecting |

**Why:** The old code collapsed DEPLOYED + CONNECTING + SYNCHRONIZING all into "connecting", so accounts appeared permanently stuck. Each state is distinct and shows a different badge in the UI.

## Frontend SETTLED_STATUSES
Must include: `connected`, `disconnected`, `failed`, `pending_approval`, `rejected` (masters) / `suspended` (slaves).
Omitting `failed` causes infinite polling on failed accounts.

## Background workers
- `accountPoller.ts` — runs every 30s, polls NON_TERMINAL statuses (deploying/connecting/synchronizing), batch size 20 for scale to 2000 accounts.
- `reconnectWorker.ts` — runs every 5min, retries deploy for `disconnected` accounts not checked in 10+ min. Logs `failed` accounts as needing manual intervention.
- Both started from `app.ts` alongside `startScheduler()`.
- `lastCheckedAt` column added to both master_accounts and slave_accounts tables.

## Admin diagnostics
- `GET /api/admin/diagnostics` — returns all accounts with summary counts by status, lastCheckedAt per account, and user email.
- `POST /api/admin/poller/run` — triggers immediate poller tick.
- Frontend page at `/admin/diagnostics`, accessible from sidebar under Admin section.
