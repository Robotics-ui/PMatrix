import https from "node:https";
import { db, adminSettingsTable, bindingsTable, strategiesTable, slaveAccountsTable, masterAccountsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

// ── CopyFactory TLS agent ─────────────────────────────────────────────────────
//
// MetaApi's CopyFactory regional domains (copyfactory-api-v1.*.agiliumtrade.ai)
// have an expired TLS certificate. Rather than toggling the process-global
// NODE_TLS_REJECT_UNAUTHORIZED env var (which leaks into concurrent requests),
// we use a dedicated https.Agent with rejectUnauthorized:false that is scoped
// only to CopyFactory calls. This agent is reused across requests for efficiency.
//
const CF_AGENT = new https.Agent({ rejectUnauthorized: false });

/**
 * Make an HTTPS request to a CopyFactory endpoint using the shared CF_AGENT
 * (which bypasses cert verification for MetaApi's expired cert). Returns the
 * same MetaApiCallResult shape as callMetaApi so callers can use either.
 */
export async function copyfactoryFetch<T = unknown>(
  method: string,
  url: string,
  token: string,
  body?: unknown
): Promise<MetaApiCallResult<T>> {
  const hasBody = body != null;
  const headers: Record<string, string> = { "auth-token": token };
  if (hasBody) headers["Content-Type"] = "application/json";
  const bodyStr = hasBody ? JSON.stringify(body) : undefined;

  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port ? parseInt(u.port, 10) : 443,
        path: u.pathname + u.search,
        method,
        headers,
        agent: CF_AGENT,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const rawText = Buffer.concat(chunks).toString("utf8");
          let data: T;
          try { data = JSON.parse(rawText) as T; } catch { data = rawText as unknown as T; }
          const status = res.statusCode ?? 0;
          const ok = status >= 200 && status < 300;
          logger.info(
            { metaApiAudit: "response", method, url, httpStatus: status, ok, responseBody: data },
            `CopyFactory ← ${status} ${method} ${url}`
          );
          resolve({ ok, status, data });
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    logger.info({ metaApiAudit: "request", method, url, body: hasBody ? body : undefined }, `CopyFactory → ${method} ${url}`);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Maps a raw MetaApi state string to a PESAMATRIX internal status string.
 * MetaApi states (in rough lifecycle order):
 *   DEPLOYING → DEPLOYED → CONNECTING → SYNCHRONIZING → CONNECTED
 *   DISCONNECTING → DISCONNECTED → UNDEPLOYING → FAILED
 */
export function mapMetaApiState(state: string): string {
  switch (state.toUpperCase()) {
    case "DEPLOYING":
      return "deploying";
    case "DEPLOYED":
      return "deployed";
    case "CONNECTING":
      return "connecting";
    case "SYNCHRONIZING":
      return "synchronizing";
    case "CONNECTED":
      return "connected";
    case "DISCONNECTING":
    case "DISCONNECTED":
    case "UNDEPLOYING":
      return "disconnected";
    case "FAILED":
    case "ERROR":
      return "failed";
    default:
      return "pending";
  }
}

// ── MetaApi token cache ───────────────────────────────────────────────────────

let cachedToken: string | null | undefined = undefined;
let cacheExpiry = 0;
const CACHE_TTL_MS = 30_000;

export async function getMetaApiToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedToken !== undefined && now < cacheExpiry) {
    return cachedToken;
  }

  try {
    const [settings] = await db.select().from(adminSettingsTable).limit(1);
    const dbToken = settings?.metaApiToken ?? null;
    cachedToken = dbToken ?? process.env.METAAPI_TOKEN ?? null;
  } catch {
    cachedToken = process.env.METAAPI_TOKEN ?? null;
  }

  cacheExpiry = now + CACHE_TTL_MS;
  return cachedToken;
}

export function invalidateMetaApiTokenCache(): void {
  cachedToken = undefined;
  cacheExpiry = 0;
}

// ── CopyFactory regional API base URL ─────────────────────────────────────────
//
// MetaApi's CopyFactory API is region-specific. Each MetaApi account has a
// `region` field (e.g. "london", "vint-hill", "us-west"). The correct base URL
// is constructed from that region.
//
// OLD (decommissioned, returns nginx 404): copyfactory-api-v1.agiliumtrade.agiliumtrade.ai
// NEW (correct):                           copyfactory-api-v1.{region}.agiliumtrade.ai
//
export function getCopyFactoryApiBase(region: string): string {
  return `https://copyfactory-api-v1.${region}.agiliumtrade.ai`;
}

// ── Audited HTTP helper ───────────────────────────────────────────────────────

export const PROVISIONING_API = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";

export type MetaApiCallResult<T = unknown> = {
  ok: boolean;
  status: number;
  data: T;
};

/**
 * Make a MetaApi REST call with full request/response audit logging.
 * Every outbound request and every API response body is written to the
 * structured logger so operators can verify account creation/deployment
 * against MetaApi's actual responses.
 */
export async function callMetaApi<T = unknown>(
  method: string,
  url: string,
  token: string,
  body?: unknown
): Promise<MetaApiCallResult<T>> {
  const hasBody = body != null;

  logger.info(
    {
      metaApiAudit: "request",
      method,
      url,
      body: hasBody ? body : undefined,
    },
    `MetaApi → ${method} ${url}`
  );

  const headers: Record<string, string> = { "auth-token": token };
  if (hasBody) headers["Content-Type"] = "application/json";

  // CopyFactory regional domains have an expired TLS cert — route through copyfactoryFetch
  // which uses a dedicated https.Agent, keeping TLS bypass scoped to those calls only.
  if (url.includes("copyfactory-api-v1")) {
    return copyfactoryFetch<T>(method, url, token, body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
    });
  } catch (fetchErr) {
    logger.error(
      { metaApiAudit: "network-error", method, url, err: fetchErr },
      `MetaApi network error on ${method} ${url}`
    );
    throw fetchErr;
  }

  let data: T;
  const rawText = await response.text();
  try {
    data = JSON.parse(rawText) as T;
  } catch {
    data = rawText as unknown as T;
  }

  logger.info(
    {
      metaApiAudit: "response",
      method,
      url,
      httpStatus: response.status,
      ok: response.ok,
      responseBody: data,
    },
    `MetaApi ← ${response.status} ${method} ${url}`
  );

  return { ok: response.ok, status: response.status, data };
}

// ── CopyFactory provider role check ──────────────────────────────────────────
//
// In MetaApi V5 (cloud-g2), `copyFactoryRoles: ["PROVIDER"]` MUST be set in
// the account creation POST body. It cannot be changed via PUT after creation
// (MetaApi returns 400 ValidationError: "Unexpected value" for every attempt).
//
// There is no separate provider "registration" endpoint in the CopyFactory API.
// An account with copyFactoryRoles:["PROVIDER"] is automatically a provider.
// Strategy creation (PUT /configuration/strategies/{4-char-id}) is what links
// the provider account to CopyFactory copy-trading.
//
// This function reads the current MetaApi account state and marks the DB record
// as "registered" if the account was created with the correct role, or "failed"
// with a clear re-creation instruction if the role is missing.
//
export async function checkAndMarkProviderRole(
  masterAccountId: number,
  metaapiAccountId: string
): Promise<{ ok: boolean; error: string | null }> {
  const token = await getMetaApiToken();
  if (!token) {
    const err = "MetaApi token not configured";
    await db
      .update(masterAccountsTable)
      .set({ copyFactoryProviderStatus: "failed", copyFactoryLastError: err })
      .where(eq(masterAccountsTable.id, masterAccountId));
    return { ok: false, error: err };
  }

  const result = await callMetaApi<{ copyFactoryRoles?: string[] }>(
    "GET",
    `${PROVISIONING_API}/users/current/accounts/${metaapiAccountId}`,
    token
  );

  if (!result.ok) {
    const err = `MetaApi GET returned HTTP ${result.status}`;
    await db
      .update(masterAccountsTable)
      .set({ copyFactoryProviderStatus: "failed", copyFactoryLastError: err })
      .where(eq(masterAccountsTable.id, masterAccountId));
    return { ok: false, error: err };
  }

  const roles: string[] = (result.data as { copyFactoryRoles?: string[] }).copyFactoryRoles ?? [];
  if (roles.includes("PROVIDER")) {
    await db
      .update(masterAccountsTable)
      .set({
        copyFactoryProviderStatus: "registered",
        copyFactoryLastError: null,
        copyFactoryProviderRegisteredAt: new Date(),
      })
      .where(eq(masterAccountsTable.id, masterAccountId));
    logger.info({ masterAccountId, metaapiAccountId }, "CopyFactory provider role confirmed — marked as registered");
    return { ok: true, error: null };
  }

  const err =
    'Account was created without copyFactoryRoles:["PROVIDER"]. ' +
    "Delete this master account record, re-submit it, and re-approve it so a fresh " +
    "MetaApi account is provisioned with the correct provider role.";
  await db
    .update(masterAccountsTable)
    .set({ copyFactoryProviderStatus: "failed", copyFactoryLastError: err })
    .where(eq(masterAccountsTable.id, masterAccountId));
  logger.warn({ masterAccountId, metaapiAccountId, roles }, "CopyFactory provider role missing — account needs recreation");
  return { ok: false, error: err };
}

// ── CopyFactory subscriber role check & auto-fix ─────────────────────────────

/**
 * Verifies that a slave account is registered as a CopyFactory subscriber and
 * auto-fixes the registration if it is missing.
 *
 * Uses the account's stored MetaApi region to construct the correct regional
 * CopyFactory API base URL (e.g. copyfactory-api-v1.london.agiliumtrade.ai).
 */
export async function ensureSlaveSubscriberRole(slaveAccountId: number): Promise<boolean> {
  const token = await getMetaApiToken();
  if (!token) {
    logger.debug({ slaveAccountId }, "MetaApi token not configured — skipping subscriber role check");
    return false;
  }

  const [slave] = await db
    .select()
    .from(slaveAccountsTable)
    .where(eq(slaveAccountsTable.id, slaveAccountId));

  if (!slave?.metaapiAccountId) {
    logger.debug({ slaveAccountId }, "Slave has no MetaApi account ID — skipping subscriber role check");
    return false;
  }

  const { metaapiAccountId } = slave;
  const cfBase = getCopyFactoryApiBase(slave.metaapiRegion ?? "vint-hill");

  // ── Step 1: Check whether already registered in CopyFactory ────────────────
  let alreadyRegistered = false;
  try {
    const checkResult = await callMetaApi(
      "GET",
      `${cfBase}/users/current/configuration/subscribers/${metaapiAccountId}`,
      token
    );

    if (checkResult.ok) {
      alreadyRegistered = true;
      logger.info(
        { slaveAccountId, metaapiAccountId },
        "CopyFactory subscriber already registered — no action needed"
      );
      await db
        .update(slaveAccountsTable)
        .set({
          copyFactorySubscriberId: metaapiAccountId,
          copyFactorySubscriberStatus: "registered",
          copyFactoryLastApiResponse: JSON.stringify(checkResult.data).slice(0, 1000),
          copyFactoryLastError: null,
        })
        .where(eq(slaveAccountsTable.id, slaveAccountId));
      return true;
    }

    if (checkResult.status !== 404) {
      logger.warn(
        { slaveAccountId, metaapiAccountId, status: checkResult.status, body: checkResult.data },
        "CopyFactory subscriber GET returned unexpected status — will attempt registration anyway"
      );
    }
  } catch (err) {
    logger.warn({ err, slaveAccountId }, "CopyFactory subscriber GET failed — will attempt registration");
  }

  if (alreadyRegistered) return true;

  // ── Step 2: Assign SUBSCRIBER role on MetaApi provisioning account ──────────
  // Note: copyFactoryRoles:["SUBSCRIBER"] should ideally be set at account
  // creation time (same as PROVIDER). The PUT attempt is kept here for
  // backward-compatibility with slave accounts that pre-date this requirement.
  try {
    const roleResult = await callMetaApi(
      "PUT",
      `${PROVISIONING_API}/users/current/accounts/${metaapiAccountId}`,
      token,
      { copyFactoryRoles: ["SUBSCRIBER"] }
    );
    if (!roleResult.ok) {
      logger.warn(
        { slaveAccountId, metaapiAccountId, status: roleResult.status, body: roleResult.data },
        "CopyFactory: setting SUBSCRIBER role returned non-OK (continuing to CF registration)"
      );
    } else {
      logger.info({ slaveAccountId, metaapiAccountId }, "CopyFactory: SUBSCRIBER role set on MetaApi provisioning account");
    }
  } catch (err) {
    logger.warn({ err, slaveAccountId }, "CopyFactory: error setting SUBSCRIBER role (continuing)");
  }

  // ── Step 3: Register subscriber configuration in CopyFactory ────────────────
  try {
    const regResult = await callMetaApi(
      "PUT",
      `${cfBase}/users/current/configuration/subscribers/${metaapiAccountId}`,
      token,
      { subscriptions: [] }
    );

    const ok = regResult.ok || regResult.status === 204;
    const responseSnippet = JSON.stringify(regResult.data).slice(0, 1000);

    await db
      .update(slaveAccountsTable)
      .set({
        copyFactorySubscriberId: ok ? metaapiAccountId : null,
        copyFactorySubscriberStatus: ok ? "registered" : "failed",
        copyFactorySubscriberRegisteredAt: ok ? new Date() : null,
        copyFactoryLastApiResponse: responseSnippet,
        copyFactoryLastError: ok
          ? null
          : `CF subscriber PUT returned HTTP ${regResult.status}: ${responseSnippet.slice(0, 300)}`,
      })
      .where(eq(slaveAccountsTable.id, slaveAccountId));

    if (ok) {
      logger.info({ slaveAccountId, metaapiAccountId }, "CopyFactory subscriber registered successfully (auto-fixed)");
    } else {
      logger.error(
        { slaveAccountId, metaapiAccountId, status: regResult.status, body: regResult.data },
        "CopyFactory subscriber registration failed"
      );
    }

    return ok;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(slaveAccountsTable)
      .set({
        copyFactorySubscriberStatus: "failed",
        copyFactoryLastError: msg,
        copyFactoryLastApiResponse: null,
      })
      .where(eq(slaveAccountsTable.id, slaveAccountId));
    logger.error({ err, slaveAccountId, metaapiAccountId }, "CopyFactory subscriber registration network error");
    return false;
  }
}

// ── CopyFactory subscriber sync ───────────────────────────────────────────────

/**
 * Reads all active bindings for a slave account from the database and pushes
 * the resulting subscriptions list to the CopyFactory subscriber configuration.
 */
export async function syncSlaveSubscriberToCopyFactory(slaveAccountId: number): Promise<void> {
  const token = await getMetaApiToken();
  if (!token) {
    logger.debug({ slaveAccountId }, "MetaApi token not configured — skipping CopyFactory sync");
    return;
  }

  const [slave] = await db
    .select()
    .from(slaveAccountsTable)
    .where(eq(slaveAccountsTable.id, slaveAccountId));

  if (!slave?.metaapiAccountId) {
    logger.debug({ slaveAccountId }, "Slave account has no MetaApi account ID — skipping CopyFactory sync");
    return;
  }

  // If the subscriber was never registered in CopyFactory (e.g. the scheduler is calling this
  // on subscription expiry/renewal and the account missed initial registration), auto-register
  // now. ensureSlaveSubscriberRole is idempotent and will no-op if already registered.
  if (!slave.copyFactorySubscriberId) {
    logger.info({ slaveAccountId }, "CopyFactory sync: subscriber not registered — attempting registration first");
    const registered = await ensureSlaveSubscriberRole(slaveAccountId);
    if (!registered) {
      logger.warn({ slaveAccountId }, "CopyFactory sync: subscriber registration failed — skipping subscription push");
      return;
    }
  }

  const cfBase = getCopyFactoryApiBase(slave.metaapiRegion ?? "vint-hill");

  const activeBindings = await db
    .select()
    .from(bindingsTable)
    .where(and(eq(bindingsTable.slaveAccountId, slaveAccountId), eq(bindingsTable.status, "active")));

  const subscriptions: Array<{ strategyId: string; multiplier: number }> = [];
  for (const binding of activeBindings) {
    const [strategy] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.id, binding.strategyId));

    if (strategy?.copyfactoryStrategyId) {
      subscriptions.push({
        strategyId: strategy.copyfactoryStrategyId,
        multiplier: parseFloat(binding.riskMultiplier as string),
      });
    } else {
      logger.warn(
        { slaveAccountId, bindingId: binding.id, strategyId: binding.strategyId },
        "CopyFactory sync: binding skipped — strategy has no copyfactoryStrategyId (repair needed)"
      );
    }
  }

  const syncName = `${slave.broker} ${slave.mt5Login}`;
  try {
    const result = await callMetaApi(
      "PUT",
      `${cfBase}/users/current/configuration/subscribers/${slave.metaapiAccountId}`,
      token,
      { name: syncName, subscriptions }
    );

    if (!result.ok) {
      logger.error(
        { slaveAccountId, metaapiAccountId: slave.metaapiAccountId, status: result.status, body: result.data },
        "CopyFactory subscriber sync returned non-OK status"
      );
    } else {
      const syncedAt = new Date();
      await db
        .update(slaveAccountsTable)
        .set({ copyFactoryLastSyncedAt: syncedAt })
        .where(eq(slaveAccountsTable.id, slaveAccountId));

      for (const binding of activeBindings) {
        await db
          .update(bindingsTable)
          .set({ lastSyncedAt: syncedAt })
          .where(eq(bindingsTable.id, binding.id));
      }

      logger.info(
        { slaveAccountId, metaapiAccountId: slave.metaapiAccountId, subscriptionCount: subscriptions.length },
        "CopyFactory subscriber synced successfully"
      );
    }
  } catch (err) {
    logger.error(
      { err, slaveAccountId, metaapiAccountId: slave.metaapiAccountId },
      "CopyFactory subscriber sync failed (network/request error)"
    );
  }
}
