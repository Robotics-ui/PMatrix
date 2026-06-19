import { inArray, isNotNull, and, or, isNull, lt } from "drizzle-orm";
import { db, masterAccountsTable, slaveAccountsTable } from "@workspace/db";
import { getMetaApiToken } from "./metaapi";
import { logger } from "./logger";

const PROVISIONING_API = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
const RECONNECT_INTERVAL_MS = 5 * 60 * 1000;
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

async function attemptRedeploy(metaapiAccountId: string, token: string, label: string): Promise<void> {
  try {
    const response = await fetch(
      `${PROVISIONING_API}/users/current/accounts/${metaapiAccountId}/deploy`,
      { method: "POST", headers: { "auth-token": token } }
    );
    if (response.ok || response.status === 204) {
      logger.info({ metaapiAccountId, label }, "Reconnect worker: deploy retried");
    } else {
      const body = await response.text().catch(() => "");
      logger.warn(
        { metaapiAccountId, label, status: response.status, body },
        "Reconnect worker: deploy retry returned non-OK"
      );
    }
  } catch (err) {
    logger.error({ metaapiAccountId, label, err }, "Reconnect worker: deploy retry error");
  }
}

async function runReconnectTick(): Promise<void> {
  try {
    const token = await getMetaApiToken();
    if (!token) return;

    const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

    const disconnectedMasters = await db
      .select()
      .from(masterAccountsTable)
      .where(
        and(
          inArray(masterAccountsTable.status, ["disconnected"]),
          isNotNull(masterAccountsTable.metaapiAccountId),
          or(isNull(masterAccountsTable.lastCheckedAt), lt(masterAccountsTable.lastCheckedAt, staleThreshold))
        )
      );

    const disconnectedSlaves = await db
      .select()
      .from(slaveAccountsTable)
      .where(
        and(
          inArray(slaveAccountsTable.status, ["disconnected"]),
          isNotNull(slaveAccountsTable.metaapiAccountId),
          or(isNull(slaveAccountsTable.lastCheckedAt), lt(slaveAccountsTable.lastCheckedAt, staleThreshold))
        )
      );

    const failedMasters = await db
      .select({ id: masterAccountsTable.id, metaapiAccountId: masterAccountsTable.metaapiAccountId })
      .from(masterAccountsTable)
      .where(
        and(
          inArray(masterAccountsTable.status, ["failed"]),
          isNotNull(masterAccountsTable.metaapiAccountId)
        )
      );

    const failedSlaves = await db
      .select({ id: slaveAccountsTable.id, metaapiAccountId: slaveAccountsTable.metaapiAccountId })
      .from(slaveAccountsTable)
      .where(
        and(
          inArray(slaveAccountsTable.status, ["failed"]),
          isNotNull(slaveAccountsTable.metaapiAccountId)
        )
      );

    if (failedMasters.length > 0) {
      logger.warn(
        { count: failedMasters.length, ids: failedMasters.map((a) => a.id) },
        "Reconnect worker: master accounts in FAILED state — check credentials / broker server"
      );
    }
    if (failedSlaves.length > 0) {
      logger.warn(
        { count: failedSlaves.length, ids: failedSlaves.map((a) => a.id) },
        "Reconnect worker: slave accounts in FAILED state — check credentials / broker server"
      );
    }

    for (const acc of disconnectedMasters) {
      logger.info({ id: acc.id, metaapiAccountId: acc.metaapiAccountId }, "Reconnect worker: retrying disconnected master");
      await attemptRedeploy(acc.metaapiAccountId!, token, `master-${acc.id}`);
    }

    for (const acc of disconnectedSlaves) {
      logger.info({ id: acc.id, metaapiAccountId: acc.metaapiAccountId }, "Reconnect worker: retrying disconnected slave");
      await attemptRedeploy(acc.metaapiAccountId!, token, `slave-${acc.id}`);
    }

    const totalActioned = disconnectedMasters.length + disconnectedSlaves.length;
    const totalFailed = failedMasters.length + failedSlaves.length;

    if (totalActioned > 0 || totalFailed > 0) {
      logger.info(
        { retried: totalActioned, failed: totalFailed },
        "Reconnect worker tick completed"
      );
    }
  } catch (err) {
    logger.error({ err }, "Reconnect worker tick failed");
  }
}

export function startReconnectWorker(): void {
  setInterval(() => {
    void runReconnectTick();
  }, RECONNECT_INTERVAL_MS);
  logger.info({ intervalMs: RECONNECT_INTERVAL_MS }, "MetaApi reconnect worker started");
}
