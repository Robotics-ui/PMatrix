import cron from "node-cron";
import { eq, inArray, and, or } from "drizzle-orm";
import {
  db,
  subscriptionsTable,
  slaveAccountsTable,
  bindingsTable,
  usersTable,
  adminSettingsTable,
  notificationsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { syncSlaveSubscriberToCopyFactory } from "./metaapi";
import { notifySubscriptionExpired, notifySubscriptionExpiring } from "./smsNotifier";
import { processReferralReward } from "./promoCode";

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
  const mins = now.getMinutes();
  const nextMins = Math.ceil((mins + 1) / 5) * 5;
  if (nextMins < 60) {
    next.setMinutes(nextMins);
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

  logger.info({ runAt: log.runAt }, "Subscription enforcement worker started");

  try {
    const now = new Date();

    // Fetch only actionable subscriptions (active, free_trial, or expired).
    // Cancelled/pending rows are never touched by this worker.
    const allSubs = await db
      .select()
      .from(subscriptionsTable)
      .where(
        or(
          eq(subscriptionsTable.status, "active"),
          eq(subscriptionsTable.status, "free_trial"),
          eq(subscriptionsTable.status, "expired"),
        ),
      );
    log.totalChecked = allSubs.length;

    logger.info(
      { totalChecked: log.totalChecked },
      "Fetched actionable subscriptions from database",
    );

    for (const sub of allSubs) {
      try {
        const isExpiredByDate = sub.endDate != null && sub.endDate <= now;
        const isRenewed =
          sub.status === "expired" &&
          sub.endDate != null &&
          sub.endDate > now;

        // ── Active / free_trial — not yet expired ─────────────────────
        if (
          (sub.status === "active" || sub.status === "free_trial") &&
          !isExpiredByDate
        ) {
          log.totalActive++;
          continue;
        }

        // ── Paid subscription expired ─────────────────────────────────
        if (sub.status === "active" && isExpiredByDate) {
          log.totalExpired++;

          logger.info(
            { userId: sub.userId, subId: sub.id, endDate: sub.endDate },
            "Expiring subscription — end date passed",
          );

          await db
            .update(subscriptionsTable)
            .set({ status: "expired" })
            .where(eq(subscriptionsTable.id, sub.id));

          await db.insert(notificationsTable).values({
            userId: sub.userId,
            type: "subscription_expired",
            title: "Subscription Expired",
            message:
              "Your subscription has expired. Renew now to continue receiving copy trades.",
          });

          const [expiredUser] = await db
            .select()
            .from(usersTable)
            .where(eq(usersTable.id, sub.userId))
            .limit(1);
          if (expiredUser?.phone) {
            notifySubscriptionExpired({
              userId: sub.userId,
              phone: expiredUser.phone,
              name: expiredUser.name,
            });
          }

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
            "Subscription expired — bindings suspended and CopyFactory synced",
          );

          continue;
        }

        // ── Free trial expired ────────────────────────────────────────
        if (sub.status === "free_trial" && isExpiredByDate) {
          log.totalExpired++;

          logger.info(
            { userId: sub.userId, subId: sub.id, endDate: sub.endDate },
            "Free trial expired — suspending bindings",
          );

          await db
            .update(subscriptionsTable)
            .set({ status: "expired" })
            .where(eq(subscriptionsTable.id, sub.id));

          await db.insert(notificationsTable).values({
            userId: sub.userId,
            type: "trial_expired",
            title: "Free Trial Ended",
            message:
              "Your 2-day free trial has ended. Subscribe now to continue receiving copy trades.",
          });

          const [trialUser] = await db
            .select()
            .from(usersTable)
            .where(eq(usersTable.id, sub.userId))
            .limit(1);
          if (trialUser?.phone) {
            notifySubscriptionExpired({
              userId: sub.userId,
              phone: trialUser.phone,
              name: trialUser.name,
            });
          }

          // Process referral reward — trial completed
          await processReferralReward(sub.userId);

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
                const msg = `CopyFactory unbind (trial) failed for slave ${slave.id}: ${String(cfErr)}`;
                log.errors.push(msg);
                logger.error({ slaveId: slave.id, err: cfErr }, msg);
              }
            }
          }

          logger.info(
            { userId: sub.userId, slaveCount: slaveIds.length },
            "Free trial expired — bindings suspended and CopyFactory synced",
          );

          continue;
        }

        // ── Renewal: expired subscription with future endDate ─────────
        if (isRenewed) {
          log.totalRenewed++;

          logger.info(
            { userId: sub.userId, subId: sub.id, endDate: sub.endDate },
            "Renewed subscription detected — reactivating bindings",
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
                  eq(bindingsTable.status, "suspended"),
                ),
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
            "Renewed subscription — bindings reactivated and CopyFactory synced",
          );

          continue;
        }

        // expired status, endDate in the past — already handled, nothing to do
      } catch (subErr) {
        log.totalFailures++;
        const msg = `Failed to process subscription ${sub.id} (user ${sub.userId}): ${String(subErr)}`;
        log.errors.push(msg);
        logger.error(
          { subId: sub.id, userId: sub.userId, err: subErr },
          msg,
        );
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
      "Subscription enforcement worker finished",
    );
  }
}

// ─── Multi-step expiry warning tick ──────────────────────────────────────────

export async function runExpiryWarningTick(): Promise<void> {
  const [settings] = await db
    .select()
    .from(adminSettingsTable)
    .orderBy(adminSettingsTable.id)
    .limit(1);
  const warningDays = settings?.expiryWarningDays ?? 3;

  const now = new Date();
  const threeDayWindow = new Date(
    now.getTime() + warningDays * 24 * 60 * 60 * 1000,
  );
  const oneDayWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const sixHourWindow = new Date(now.getTime() + 6 * 60 * 60 * 1000);

  // Include free_trial subscriptions in expiry warnings
  const activeSubs = await db
    .select()
    .from(subscriptionsTable)
    .where(
      or(
        eq(subscriptionsTable.status, "active"),
        eq(subscriptionsTable.status, "free_trial"),
      ),
    );

  let warned = 0;
  let skipped = 0;

  for (const sub of activeSubs) {
    if (!sub.endDate) continue;
    if (sub.endDate <= now) continue; // enforcement tick handles actual expiry

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, sub.userId))
      .limit(1);

    if (!user?.phone) continue;

    const daysLeft = Math.max(
      0,
      Math.ceil(
        (sub.endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      ),
    );
    const endDateStr = sub.endDate.toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    // ── 3-day warning ──────────────────────────────────────────────────
    if (
      warningDays > 0 &&
      sub.endDate <= threeDayWindow &&
      !(
        sub.expiryWarningSentAt &&
        sub.startDate &&
        sub.expiryWarningSentAt >= sub.startDate
      )
    ) {
      notifySubscriptionExpiring({
        userId: sub.userId,
        phone: user.phone,
        name: user.name,
        endDate: endDateStr,
        daysLeft: String(daysLeft),
      });
      await db.insert(notificationsTable).values({
        userId: sub.userId,
        type: "subscription_expiring_3d",
        title: `Subscription Expiring in ${daysLeft} Day(s)`,
        message: `Your subscription expires on ${endDateStr}. Renew soon to keep copying trades.`,
      });
      await db
        .update(subscriptionsTable)
        .set({ expiryWarningSentAt: now })
        .where(eq(subscriptionsTable.id, sub.id));
      warned++;
      logger.info(
        { userId: sub.userId, subId: sub.id, daysLeft },
        "3-day expiry warning sent",
      );
    } else if (warningDays === 0) {
      skipped++;
    }

    // ── 1-day warning ──────────────────────────────────────────────────
    if (sub.endDate <= oneDayWindow && !sub.expiryWarning1DSentAt) {
      notifySubscriptionExpiring({
        userId: sub.userId,
        phone: user.phone,
        name: user.name,
        endDate: endDateStr,
        daysLeft: "1",
      });
      await db.insert(notificationsTable).values({
        userId: sub.userId,
        type: "subscription_expiring_1d",
        title: "Subscription Expiring Tomorrow",
        message: `Your subscription expires tomorrow (${endDateStr}). Renew now to avoid disruption.`,
      });
      await db
        .update(subscriptionsTable)
        .set({ expiryWarning1DSentAt: now })
        .where(eq(subscriptionsTable.id, sub.id));
      warned++;
      logger.info(
        { userId: sub.userId, subId: sub.id },
        "1-day expiry warning sent",
      );
    }

    // ── Same-day (6-hour) warning ──────────────────────────────────────
    if (sub.endDate <= sixHourWindow && !sub.expiryWarning0DSentAt) {
      notifySubscriptionExpiring({
        userId: sub.userId,
        phone: user.phone,
        name: user.name,
        endDate: endDateStr,
        daysLeft: "0",
      });
      await db.insert(notificationsTable).values({
        userId: sub.userId,
        type: "subscription_expiring_today",
        title: "Subscription Expires Today",
        message: `Your subscription expires today. Renew now to continue receiving copy trades.`,
      });
      await db
        .update(subscriptionsTable)
        .set({ expiryWarning0DSentAt: now })
        .where(eq(subscriptionsTable.id, sub.id));
      warned++;
      logger.info(
        { userId: sub.userId, subId: sub.id },
        "Same-day expiry warning sent",
      );
    }
  }

  logger.info(
    { warned, skipped, warningDays },
    "Expiry warning tick complete",
  );
}

// ─── Scheduler bootstrap ────────────────────────────────────────────────────

export function startScheduler(): void {
  cron.schedule("*/5 * * * *", () => {
    void runEnforcementTick();
    void runExpiryWarningTick();
  });

  logger.info(
    { schedule: "*/5 * * * *", nextRunAt: computeNextRunAt().toISOString() },
    "Subscription enforcement scheduler started (every 5 minutes)",
  );
}
