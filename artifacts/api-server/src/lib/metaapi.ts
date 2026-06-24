import { db, adminSettingsTable, bindingsTable, strategiesTable, slaveAccountsTable, masterAccountsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "./logger";

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
      // "pending" — not yet submitted to MetaApi or unknown intermediate state
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

// ── Audited HTTP helper ───────────────────────────────────────────────────────

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

// ── CopyFactory provider registration ────────────────────────────────────────

const COPYFACTORY_API = "https://copyfactory-api-v1.agiliumtrade.agiliumtrade.ai";
const PROVISIONING_API = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";

/**
 * Registers a master account as a CopyFactory signal provider.
 *
 * Two steps:
 *   1. PATCH the MetaApi provisioning account to add roles: ["provider"]
 *      (ensures the account is recognised by CopyFactory as a signal source)
 *   2. PUT the CopyFactory provider configuration entry
 *      (creates/updates the provider record CopyFactory uses for strategy linkage)
 *
 * Updates copyFactoryProvider* columns in master_accounts on every call so
 * the diagnostics page always reflects the latest attempt.
 */
export async function registerMasterAsProvider(
  masterAccountId: number,
  metaapiAccountId: string,
  name: string
): Promise<{ ok: boolean; providerId: string | null; error: string | null }> {
  const token = await getMetaApiToken();
  if (!token) {
    const err = "MetaApi token not configured";
    await db
      .update(masterAccountsTable)
      .set({ copyFactoryProviderStatus: "failed", copyFactoryLastError: err })
      .where(eq(masterAccountsTable.id, masterAccountId));
    return { ok: false, providerId: null, error: err };
  }

  // ── Step 1: Assign provider role on MetaApi provisioning account ───────────
  try {
    const roleResult = await callMetaApi(
      "PUT",
      `${PROVISIONING_API}/users/current/accounts/${metaapiAccountId}`,
      token,
      { roles: ["provider"] }
    );
    if (!roleResult.ok) {
      logger.warn(
        { masterAccountId, metaapiAccountId, status: roleResult.status, body: roleResult.data },
        "CopyFactory: setting provider role on MetaApi account returned non-OK (continuing to CF registration)"
      );
    } else {
      logger.info(
        { masterAccountId, metaapiAccountId },
        "CopyFactory: provider role set on MetaApi provisioning account"
      );
    }
  } catch (err) {
    logger.warn({ err, masterAccountId }, "CopyFactory: error setting provider role on MetaApi account (continuing)");
  }

  // ── Step 2: Create/update CopyFactory provider configuration entry ─────────
  const providerId = metaapiAccountId; // CF uses the MetaApi account ID as the provider ID
  try {
    const cfResult = await callMetaApi(
      "PUT",
      `${COPYFACTORY_API}/users/current/configuration/providers/${providerId}`,
      token,
      { name }
    );

    const ok = cfResult.ok || cfResult.status === 204;
    const responseSnippet = JSON.stringify(cfResult.data).slice(0, 1000);

    await db
      .update(masterAccountsTable)
      .set({
        copyFactoryProviderId: ok ? providerId : null,
        copyFactoryProviderStatus: ok ? "registered" : "failed",
        copyFactoryProviderRegisteredAt: ok ? new Date() : null,
        copyFactoryLastApiResponse: responseSnippet,
        copyFactoryLastError: ok
          ? null
          : `CF provider PUT returned HTTP ${cfResult.status}: ${responseSnippet.slice(0, 300)}`,
      })
      .where(eq(masterAccountsTable.id, masterAccountId));

    if (ok) {
      logger.info(
        { masterAccountId, metaapiAccountId, providerId },
        "CopyFactory provider registered successfully"
      );
    } else {
      logger.error(
        { masterAccountId, metaapiAccountId, status: cfResult.status, body: cfResult.data },
        "CopyFactory provider registration failed"
      );
    }

    return { ok, providerId: ok ? providerId : null, error: ok ? null : `HTTP ${cfResult.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(masterAccountsTable)
      .set({
        copyFactoryProviderStatus: "failed",
        copyFactoryLastError: msg,
        copyFactoryLastApiResponse: null,
      })
      .where(eq(masterAccountsTable.id, masterAccountId));
    logger.error({ err, masterAccountId, metaapiAccountId }, "CopyFactory provider registration network error");
    return { ok: false, providerId: null, error: msg };
  }
}

// ── CopyFactory subscriber role check & auto-fix ─────────────────────────────

/**
 * Verifies that a slave account is registered as a CopyFactory subscriber and
 * auto-fixes the registration if it is missing.
 *
 * Steps:
 *   1. GET the subscriber record from CopyFactory. A 404 means it was never
 *      registered; any other non-OK status is treated as an unknown error.
 *   2. If the record is absent, ensure the MetaApi provisioning account has the
 *      "subscriber" role (PUT roles: ["subscriber"] on the provisioning API).
 *   3. PUT the subscriber configuration to CopyFactory (empty subscriptions list
 *      is fine — syncSlaveSubscriberToCopyFactory will fill it in afterwards).
 *   4. Persist the result in the slave_accounts diagnostic columns so the admin
 *      can see registration state without hitting the CopyFactory API.
 *
 * Returns `true` when the account is confirmed or newly registered, `false`
 * on any unrecoverable error.
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

  // ── Step 1: Check whether already registered in CopyFactory ────────────────
  let alreadyRegistered = false;
  try {
    const checkResult = await callMetaApi(
      "GET",
      `${COPYFACTORY_API}/users/current/configuration/subscribers/${metaapiAccountId}`,
      token
    );

    if (checkResult.ok) {
      // Already registered — refresh diagnostic columns and return early
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
      // Unexpected error from CopyFactory — log and continue to attempt registration
      logger.warn(
        { slaveAccountId, metaapiAccountId, status: checkResult.status, body: checkResult.data },
        "CopyFactory subscriber GET returned unexpected status — will attempt registration anyway"
      );
    }
    // 404 → not registered yet; fall through to registration steps
  } catch (err) {
    logger.warn({ err, slaveAccountId }, "CopyFactory subscriber GET failed — will attempt registration");
  }

  if (alreadyRegistered) return true;

  // ── Step 2: Assign subscriber role on MetaApi provisioning account ──────────
  try {
    const roleResult = await callMetaApi(
      "PUT",
      `${PROVISIONING_API}/users/current/accounts/${metaapiAccountId}`,
      token,
      { roles: ["subscriber"] }
    );
    if (!roleResult.ok) {
      logger.warn(
        { slaveAccountId, metaapiAccountId, status: roleResult.status, body: roleResult.data },
        "CopyFactory: setting subscriber role returned non-OK (continuing to CF registration)"
      );
    } else {
      logger.info({ slaveAccountId, metaapiAccountId }, "CopyFactory: subscriber role set on MetaApi provisioning account");
    }
  } catch (err) {
    logger.warn({ err, slaveAccountId }, "CopyFactory: error setting subscriber role (continuing)");
  }

  // ── Step 3: Register subscriber configuration in CopyFactory ────────────────
  try {
    const regResult = await callMetaApi(
      "PUT",
      `${COPYFACTORY_API}/users/current/configuration/subscribers/${metaapiAccountId}`,
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
      logger.info(
        { slaveAccountId, metaapiAccountId },
        "CopyFactory subscriber registered successfully (auto-fixed)"
      );
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
    }
  }

  try {
    const result = await callMetaApi(
      "PUT",
      `${COPYFACTORY_API}/users/current/configuration/subscribers/${slave.metaapiAccountId}`,
      token,
      { subscriptions }
    );

    if (!result.ok) {
      logger.error(
        { slaveAccountId, metaapiAccountId: slave.metaapiAccountId, status: result.status, body: result.data },
        "CopyFactory subscriber sync returned non-OK status"
      );
    } else {
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
