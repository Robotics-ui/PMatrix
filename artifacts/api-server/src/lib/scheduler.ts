import cron from "node-cron";
import { eq, inArray } from "drizzle-orm";
import { db, subscriptionsTable, slaveAccountsTable, bindingsTable } from "@workspace/db";
import { logger } from "./logger";
import { syncSlaveSubscriberToCopyFactory } from "./metaapi";

/**
 * Auto-suspension scheduler.
 * Runs every 30 minutes. Checks all active subscriptions.
 * If a subscription has expired (endDate passed), mark it expired,
 * suspend all associated slave account bindings in the database, and
 * push empty subscription lists to CopyFactory so copying stops immediately.
 */
export function startScheduler(): void {
  cron.schedule("*/30 * * * *", async () => {
    try {
      logger.info("Running subscription expiry check...");
      const now = new Date();

      const expiredSubs = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.status, "active"));

      const toExpire = expiredSubs.filter(
        (s) => s.endDate != null && s.endDate <= now
      );

      if (toExpire.length === 0) {
        logger.info("No expired subscriptions found");
        return;
      }

      logger.info({ count: toExpire.length }, "Expiring subscriptions");

      for (const sub of toExpire) {
        // Mark subscription as expired
        await db
          .update(subscriptionsTable)
          .set({ status: "expired" })
          .where(eq(subscriptionsTable.id, sub.id));

        // Get all slave accounts for this user
        const slaveAccounts = await db
          .select()
          .from(slaveAccountsTable)
          .where(eq(slaveAccountsTable.userId, sub.userId));

        const slaveIds = slaveAccounts.map((s) => s.id);

        if (slaveIds.length > 0) {
          // Suspend all bindings in the database
          await db
            .update(bindingsTable)
            .set({ status: "suspended" })
            .where(inArray(bindingsTable.slaveAccountId, slaveIds));

          // Sync each slave to CopyFactory — bindings are now suspended, so
          // syncSlaveSubscriberToCopyFactory will push an empty subscriptions list
          // which stops all copying on the MetaApi/CopyFactory side immediately.
          for (const slave of slaveAccounts) {
            await syncSlaveSubscriberToCopyFactory(slave.id);
          }

          logger.info(
            { userId: sub.userId, slaveCount: slaveIds.length },
            "Suspended bindings and synced CopyFactory for expired subscription"
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "Error in subscription expiry scheduler");
    }
  });

  logger.info("Subscription expiry scheduler started (every 30 minutes)");
}
