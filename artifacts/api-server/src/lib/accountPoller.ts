import { inArray, isNotNull, and, eq } from "drizzle-orm";
import { db, masterAccountsTable, slaveAccountsTable } from "@workspace/db";
import { getMetaApiToken, mapMetaApiState } from "./metaapi";
import { logger } from "./logger";

const PROVISIONING_API = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
const POLL_INTERVAL_MS = 30_000;
const CONCURRENCY = 20;

const NON_TERMINAL_STATUSES = ["deploying", "connecting", "synchronizing"];

let pollerRunning = false;
let pollCount = 0;

async function checkSingleMasterAccount(
  id: number,
  metaapiAccountId: string,
  token: string
): Promise<void> {
  try {
    const response = await fetch(`${PROVISIONING_API}/users/current/accounts/${metaapiAccountId}`, {
      headers: { "auth-token": token },
    });
    if (!response.ok) return;
    const data = (await response.json()) as { state?: string; connectionStatus?: string };
    const newStatus = mapMetaApiState(data.state ?? "");
    await db
      .update(masterAccountsTable)
      .set({
        status: newStatus,
        deploymentStatus: data.state ?? null,
        connectionStatus: data.connectionStatus ?? null,
        lastCheckedAt: new Date(),
      })
      .where(eq(masterAccountsTable.id, id));
    logger.debug({ id, metaapiAccountId, state: data.state, newStatus }, "Master account polled");
  } catch (err) {
    logger.warn({ id, metaapiAccountId, err }, "Failed to poll master account");
  }
}

async function checkSingleSlaveAccount(
  id: number,
  metaapiAccountId: string,
  token: string
): Promise<void> {
  try {
    const response = await fetch(`${PROVISIONING_API}/users/current/accounts/${metaapiAccountId}`, {
      headers: { "auth-token": token },
    });
    if (!response.ok) return;
    const data = (await response.json()) as { state?: string; connectionStatus?: string };
    const newStatus = mapMetaApiState(data.state ?? "");
    await db
      .update(slaveAccountsTable)
      .set({
        status: newStatus,
        deploymentStatus: data.state ?? null,
        connectionStatus: data.connectionStatus ?? null,
        lastCheckedAt: new Date(),
      })
      .where(eq(slaveAccountsTable.id, id));
    logger.debug({ id, metaapiAccountId, state: data.state, newStatus }, "Slave account polled");
  } catch (err) {
    logger.warn({ id, metaapiAccountId, err }, "Failed to poll slave account");
  }
}

async function runPollerTick(): Promise<void> {
  if (pollerRunning) {
    logger.debug("Account poller tick skipped — previous run still in progress");
    return;
  }
  pollerRunning = true;
  const startedAt = Date.now();
  try {
    const token = await getMetaApiToken();
    if (!token) return;

    const [masters, slaves] = await Promise.all([
      db
        .select({ id: masterAccountsTable.id, metaapiAccountId: masterAccountsTable.metaapiAccountId })
        .from(masterAccountsTable)
        .where(
          and(
            inArray(masterAccountsTable.status, NON_TERMINAL_STATUSES),
            isNotNull(masterAccountsTable.metaapiAccountId)
          )
        ),
      db
        .select({ id: slaveAccountsTable.id, metaapiAccountId: slaveAccountsTable.metaapiAccountId })
        .from(slaveAccountsTable)
        .where(
          and(
            inArray(slaveAccountsTable.status, NON_TERMINAL_STATUSES),
            isNotNull(slaveAccountsTable.metaapiAccountId)
          )
        ),
    ]);

    const total = masters.length + slaves.length;
    if (total === 0) return;

    pollCount++;
    logger.info(
      { poll: pollCount, masters: masters.length, slaves: slaves.length },
      "Account poller tick started"
    );

    for (let i = 0; i < masters.length; i += CONCURRENCY) {
      const chunk = masters.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        chunk.map((a) => checkSingleMasterAccount(a.id, a.metaapiAccountId!, token))
      );
    }

    for (let i = 0; i < slaves.length; i += CONCURRENCY) {
      const chunk = slaves.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        chunk.map((a) => checkSingleSlaveAccount(a.id, a.metaapiAccountId!, token))
      );
    }

    logger.info(
      { poll: pollCount, masters: masters.length, slaves: slaves.length, durationMs: Date.now() - startedAt },
      "Account poller tick finished"
    );
  } catch (err) {
    logger.error({ err }, "Account poller tick failed");
  } finally {
    pollerRunning = false;
  }
}

export function startAccountPoller(): void {
  setInterval(() => {
    void runPollerTick();
  }, POLL_INTERVAL_MS);
  logger.info({ intervalMs: POLL_INTERVAL_MS, concurrency: CONCURRENCY }, "MetaApi account status poller started");
  void runPollerTick();
}

export async function runPollerNow(): Promise<void> {
  await runPollerTick();
}
