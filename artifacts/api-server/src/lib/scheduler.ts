import cron from "node-cron";
import { eq, inArray, and, gt } from "drizzle-orm";
import { db, subscriptionsTable, slaveAccountsTable, bindingsTable } from "@workspace/db";
import { logger } from "./logger";
import { syncSlaveSubscriberToCopyFactory } from "./metaapi";

// ─── In-memory status store ────────────────────────────────────────────────

export interface SchedulerRunLog {
  runAt: string;
  durationMs: number;
  totalChecked: number;
  totalActive: number;
  totalExpired: number;
  totalRenewed: number;
  totalUnbound: number;
  totalRebound: number;
  totalFailures: number;
  errors: string[];
}

export interface SchedulerStatus {
  isRunning: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  recentRuns: SchedulerRunLog[];
  lastRun: SchedulerRunLog | null;
  unbindingsToday: number;
}

const MAX_RECENT_RUNS = 20;

const status: SchedulerStatus = {
  isRunning: false,
  lastRunAt: null,
  nextRunAt: null,
  recentRuns: [],
  lastRun: null,
  unbindingsToday: 0,
};

export function getSchedulerStatus(): SchedulerStatus {
  return { ...status, nextRunAt: computeNextRunAt().toISOString() };
}

function computeNextRunAt(): Date {
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (now.getMinutes() < 30) {
    next.setMinutes(30);
  } else {
    next.setHours(next.getHours() + 1, 0, 0, 0);
  }
  return next;
}

function isTodayRun(runAt: string): boolean {
  const runDate = new Date(runAt);
  const now = new Date();
  return (
    runDate.getFullYear() === now.getFullYear() &&
    runDate.getMonth() === now.getMonth() &&
    runDate.getDate() === now.getDate()
  );
}

function recomputeUnbindingsToday(): number {
  return status.recentRuns
    .filter((r) => isTodayRun(r.runAt))
    .reduce((sum, r) => sum + r.totalUnbound, 0);
}

// ─── Core tick logic ────────────────────────────────────────────────────────

export async function runEnforcementTick(): Promise<void> {
  if (status.isRunning) {
    logger.warn("Scheduler tick skipped — previous run still in progress");
    return;
  }

  const startedAt = new Date();
  status.isRunning = true;

  const log: SchedulerRunLog = {
    runAt: startedAt.toISOString(),
    durationMs: 0,
    totalChecked: 0,
    totalActive: 0,
    totalExpired: 0,
    totalRenewed: 0,
    totalUnbound: 0,
    totalRebound: 0,
    totalFailures: 0,
    errors: [],
  };

  logger.info(
    { runAt: log.runAt },
    "Subscription enforcement worker started"
  );

  try {
    const now = new Date();

    // Fetch ALL subscriptions — active and expired — to handle both
    // expiration and renewal in a single pass.
    const allSubs = await db.select().from(subscriptionsTable);
    log.totalChecked = allSubs.length;

    logger.info(
      { totalChecked: log.totalChecked },
      "Fetched all subscriptions from database"
    );

    for (const sub of allSubs) {
      try {
        const isExpiredByDate =
          sub.endDate != null && sub.endDate <= now;
        const isRenewed =
          sub.status === "expired" &&
          sub.endDate != null &&
          sub.endDate > now;

        if (sub.status === "active" && !isExpiredByDate) {
          // Subscription is genuinely active — ensure bindings are active
          log.totalActive++;
          continue;
        }

        if (sub.status === "active" && isExpiredByDate) {
          // Active subscription past end date → expire it
          log.totalExpired++;

          logger.info(
            { userId: sub.userId, subId: sub.id, endDate: sub.endDate },
            "Expiring subscription — end date passed"
          );

          await db
            .update(subscriptionsTable)
            .set({ status: "expired" })
            .where(eq(subscriptionsTable.id, sub.id));

          const slaveAccounts = await db
            .select()
            .from(slaveAccountsTable)
            .where(eq(slaveAccountsTable.userId, sub.userId));

          const slaveIds = slaveAccounts.map((s) => s.id);

          if (slaveIds.length > 0) {
            await db
              .update(bindingsTable)
              .set({ status: "suspended" })
              .where(inArray(bindingsTable.slaveAccountId, slaveIds));

            for (const slave of slaveAccounts) {
              try {
                await syncSlaveSubscriberToCopyFactory(slave.id);
                log.totalUnbound++;
              } catch (cfErr) {
                log.totalFailures++;
                const msg = `CopyFactory unbind failed for slave ${slave.id}: ${String(cfErr)}`;
                log.errors.push(msg);
                logger.error({ slaveId: slave.id, err: cfErr }, msg);
              }
            }
          }

          logger.info(
            {
              userId: sub.userId,
              slaveCount: slaveIds.length,
              unbound: log.totalUnbound,
            },
            "Subscription expired — bindings suspended and CopyFactory synced"
          );

          continue;
        }

        if (isRenewed) {
          // Subscription was marked expired but endDate is now in the future
          // (user renewed) — reactivate it
          log.totalRenewed++;

          logger.info(
            { userId: sub.userId, subId: sub.id, endDate: sub.endDate },
            "Renewed subscription detected — reactivating bindings"
          );

          await db
            .update(subscriptionsTable)
            .set({ status: "active" })
            .where(eq(subscriptionsTable.id, sub.id));

          const slaveAccounts = await db
            .select()
            .from(slaveAccountsTable)
            .where(eq(slaveAccountsTable.userId, sub.userId));

          const slaveIds = slaveAccounts.map((s) => s.id);

          if (slaveIds.length > 0) {
            await db
              .update(bindingsTable)
              .set({ status: "active" })
              .where(
                and(
                  inArray(bindingsTable.slaveAccountId, slaveIds),
                  eq(bindingsTable.status, "suspended")
                )
              );

            for (const slave of slaveAccounts) {
              try {
                await syncSlaveSubscriberToCopyFactory(slave.id);
                log.totalRebound++;
              } catch (cfErr) {
                log.totalFailures++;
                const msg = `CopyFactory rebind failed for slave ${slave.id}: ${String(cfErr)}`;
                log.errors.push(msg);
                logger.error({ slaveId: slave.id, err: cfErr }, msg);
              }
            }
          }

          logger.info(
            {
              userId: sub.userId,
              slaveCount: slaveIds.length,
              rebound: log.totalRebound,
            },
            "Renewed subscription — bindings reactivated and CopyFactory synced"
          );

          continue;
        }

        // expired status, endDate in the past — already handled, nothing to do
      } catch (subErr) {
        log.totalFailures++;
        const msg = `Failed to process subscription ${sub.id} (user ${sub.userId}): ${String(subErr)}`;
        log.errors.push(msg);
        logger.error({ subId: sub.id, userId: sub.userId, err: subErr }, msg);
        // Continue processing remaining subscriptions
      }
    }
  } catch (fatalErr) {
    const msg = `Fatal error in enforcement worker: ${String(fatalErr)}`;
    log.errors.push(msg);
    log.totalFailures++;
    logger.error({ err: fatalErr }, msg);
  } finally {
    log.durationMs = Date.now() - startedAt.getTime();
    status.isRunning = false;
    status.lastRunAt = log.runAt;
    status.lastRun = log;
    status.recentRuns = [log, ...status.recentRuns].slice(0, MAX_RECENT_RUNS);
    status.unbindingsToday = recomputeUnbindingsToday();

    logger.info(
      {
        durationMs: log.durationMs,
        totalChecked: log.totalChecked,
        totalActive: log.totalActive,
        totalExpired: log.totalExpired,
        totalRenewed: log.totalRenewed,
        totalUnbound: log.totalUnbound,
        totalRebound: log.totalRebound,
        totalFailures: log.totalFailures,
        errorCount: log.errors.length,
      },
      "Subscription enforcement worker finished"
    );
  }
}

// ─── Scheduler bootstrap ────────────────────────────────────────────────────

export function startScheduler(): void {
  cron.schedule("*/30 * * * *", () => {
    void runEnforcementTick();
  });

  logger.info(
    { schedule: "*/30 * * * *", nextRunAt: computeNextRunAt().toISOString() },
    "Subscription enforcement scheduler started (every 30 minutes)"
  );
}
