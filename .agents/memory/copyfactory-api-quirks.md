---
name: CopyFactory API quirks
description: Critical MetaApi CopyFactory gotchas — role field name, TLS cert, strategy creation guard, and provider registration flow.
---

## Rule 1: Role field name is `copyFactoryRoles`, not `roles`

When assigning CopyFactory roles via the MetaApi provisioning API (PUT `/users/current/accounts/:id`), the correct body is:

```json
{ "copyFactoryRoles": ["PROVIDER"] }   // for master accounts
{ "copyFactoryRoles": ["SUBSCRIBER"] } // for slave accounts
```

Do NOT use `{ "roles": [...] }` — MetaApi returns HTTP 400 "Unexpected value" for that field name.

**Why:** The provisioning API supports multiple role types; `copyFactoryRoles` is the CopyFactory-specific sub-field. The MetaApi response body shows `"copyFactoryRoles": []` confirming the correct name.

**How to apply:** Any PUT to the MetaApi provisioning accounts endpoint for CopyFactory role assignment must use `copyFactoryRoles` with uppercase values (`PROVIDER`, `SUBSCRIBER`).

---

## Rule 2: CopyFactory domain has an expired TLS cert — use copyfactoryFetch

`copyfactory-api-v1.*.agiliumtrade.ai` regional domains have an expired TLS certificate. All `fetch()` calls to these domains throw `certificate has expired`.

**Fix (current):** Use the `copyfactoryFetch(method, url, token, body?)` helper exported from `metaapi.ts`. It uses a persistent `https.Agent({ rejectUnauthorized: false })` (named `CF_AGENT`) scoped to CopyFactory calls only — no process-global env var toggling.

- `callMetaApi` automatically routes any URL containing `copyfactory-api-v1` through `copyfactoryFetch` internally.
- All direct raw `fetch()` calls to CopyFactory URLs (in `strategies.ts`, `copyfactorySync.ts`) must use `copyfactoryFetch` instead.
- **Never** use `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"` for this — it's a process-global toggle that leaks into concurrent unrelated HTTPS calls.

**Why NOT undici Agent:** `undici@8.x` (installed by pnpm) requires Node.js 22+. We run Node.js 20.20.0. The `Agent` import crashes at runtime with `webidl.util.markAsUncloneable is not a function`. Use `node:https` Agent instead.

**How to apply:** Import `copyfactoryFetch` from `../lib/metaapi` and use it for every CopyFactory PUT/GET/DELETE. Do not remove until MetaApi renews their cert.

---

## Rule 3: Strategy creation must be gated on copyFactoryProviderStatus === "registered"

The `strategies.ts` route must check `masterAccount.copyFactoryProviderStatus !== "registered"` before allowing strategy creation when MetaApi is configured. Without this guard, CopyFactory returns "The account must be a MT account added to MetaApi for use with CopyFactory 2 (provider role)" even though the account status is `deployed`.

**Why:** The internal account status (`deployed`, `active`) and CopyFactory provider registration are independent. An account can be `deployed` in our DB without being registered as a CopyFactory provider.

**How to apply:** In `strategies.ts`, after the status check, add a provider guard. In demo mode (`!metaapiToken`) this is bypassed.

---

## Rule 4: Provider registration must be awaited, not fire-and-forget

`ensureProviderRegistered` must be AWAITED in `advanceMasterAccount`. If it's fire-and-forget (`.catch()`), the account advances to `deployed` immediately and strategy creation can be attempted before provider registration completes.

Also: `advanceMasterAccount` returns early when `newStatus === currentStatus` — so accounts ALREADY at `deployed` but with unregistered provider never retry. Add a retry block before the early return for accounts in `["deployed", "strategy_created", "active"]` with unregistered provider.

---

## Rule 5: All CopyFactory raw fetch calls must use copyfactoryFetch, never raw fetch

Any direct HTTP call to a CopyFactory domain (`copyfactory-api-v1.*.agiliumtrade.ai`) must use `copyfactoryFetch()` from `metaapi.ts` — never plain `fetch()` and never `NODE_TLS_REJECT_UNAUTHORIZED` toggling. `callMetaApi()` already routes CF URLs internally through `copyfactoryFetch`, so callers using `callMetaApi` are covered. Direct `fetch()` call sites (e.g. strategy create/delete, repair loops) must import and use `copyfactoryFetch` explicitly.

---

## Rule 6: CopyFactory API uses region-specific subdomains (old global URL is decommissioned)

`copyfactory-api-v1.agiliumtrade.agiliumtrade.ai` returns nginx 404 for all requests. The correct form is `copyfactory-api-v1.{region}.agiliumtrade.ai` (e.g. `copyfactory-api-v1.london.agiliumtrade.ai`).

**Fix:** Use `getCopyFactoryApiBase(account.metaapiRegion ?? "vint-hill")` from `metaapi.ts` everywhere. Both `masterAccountsTable` and `slaveAccountsTable` have a `metaapiRegion` column. For `copyfactorySync.ts` strategy fetching, look up the first master's region.

**Repair pattern:** Strategies saved with null `copyfactoryStrategyId` (because registration failed with 404) must be repaired at startup via `repairStrategyCopyFactoryIds()` in `copyfactorySync.ts`. This is called in `app.ts` on boot. Without a CF strategy ID, `syncSlaveSubscriberToCopyFactory` skips the subscription and no trades copy.

**Why:** MetaApi regionalized their CopyFactory API infrastructure. The global endpoint was quietly decommissioned.

**How to apply:** Never hardcode `copyfactory-api-v1.agiliumtrade.agiliumtrade.ai` anywhere. Always use `getCopyFactoryApiBase(region)`.
