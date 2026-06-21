import { eq, and } from "drizzle-orm";
import {
  db,
  promoCodesTable,
  referralsTable,
  referralSettingsTable,
  subscriptionsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { createNotification } from "./notificationService";

const PREFIXES = ["PESA", "MATRIX", "FX", "TRADE", "COPY"];

function randomSuffix(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export async function generateUniquePromoCode(userId: number): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
    const code = `${prefix}${randomSuffix()}`;

    try {
      await db.insert(promoCodesTable).values({
        userId,
        code,
        totalReferrals: 0,
        totalRewardDays: 0,
      });
      logger.info({ userId, code }, "Promo code generated");
      return code;
    } catch {
      // Collision on unique constraint — retry
    }
  }

  // Last-resort fallback: embed userId to guarantee uniqueness
  const fallback = `PESA${userId}X${randomSuffix()}`;
  await db
    .insert(promoCodesTable)
    .values({ userId, code: fallback, totalReferrals: 0, totalRewardDays: 0 });
  return fallback;
}

/**
 * Called when a referred user makes their first payment or their free trial
 * ends naturally. Finds any pending referral for this user, determines the
 * correct milestone reward, extends the referrer's subscription, and marks
 * the referral as rewarded.
 */
export async function processReferralReward(referredUserId: number): Promise<void> {
  try {
    const [referral] = await db
      .select()
      .from(referralsTable)
      .where(
        and(
          eq(referralsTable.referredUserId, referredUserId),
          eq(referralsTable.status, "pending"),
        ),
      )
      .limit(1);

    if (!referral) return;

    // Total rewarded referrals for the referrer after this one
    const completedRows = await db
      .select()
      .from(referralsTable)
      .where(
        and(
          eq(referralsTable.referrerId, referral.referrerId),
          eq(referralsTable.status, "rewarded"),
        ),
      );
    const nextCount = completedRows.length + 1;

    // Find best milestone: largest referralsRequired that is <= nextCount
    const allMilestones = await db
      .select()
      .from(referralSettingsTable)
      .where(eq(referralSettingsTable.isEnabled, true))
      .orderBy(referralSettingsTable.referralsRequired);

    const milestone = allMilestones
      .filter((s) => s.referralsRequired <= nextCount)
      .sort((a, b) => b.referralsRequired - a.referralsRequired)[0];

    const rewardDays = milestone?.rewardDays ?? 1;

    // Mark referral rewarded
    await db
      .update(referralsTable)
      .set({ status: "rewarded", rewardDays, rewardedAt: new Date() })
      .where(eq(referralsTable.id, referral.id));

    // Extend referrer's subscription
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, referral.referrerId))
      .limit(1);

    if (sub) {
      const base =
        sub.endDate && sub.endDate > new Date() ? sub.endDate : new Date();
      const newEndDate = new Date(
        base.getTime() + rewardDays * 24 * 60 * 60 * 1000,
      );
      await db
        .update(subscriptionsTable)
        .set({ endDate: newEndDate })
        .where(eq(subscriptionsTable.userId, referral.referrerId));
    }

    // Update promo code running totals
    const [promoCode] = await db
      .select()
      .from(promoCodesTable)
      .where(eq(promoCodesTable.userId, referral.referrerId))
      .limit(1);

    if (promoCode) {
      await db
        .update(promoCodesTable)
        .set({
          totalReferrals: promoCode.totalReferrals + 1,
          totalRewardDays: promoCode.totalRewardDays + rewardDays,
        })
        .where(eq(promoCodesTable.userId, referral.referrerId));
    }

    await createNotification({
      userId: referral.referrerId,
      type: "referral_reward",
      title: "Referral Reward Earned",
      message: `A user you referred became active. You earned ${rewardDays} free subscription day(s).`,
    });

    logger.info(
      {
        referralId: referral.id,
        referrerId: referral.referrerId,
        referredUserId,
        rewardDays,
      },
      "Referral reward processed",
    );
  } catch (err) {
    logger.error({ err, referredUserId }, "Failed to process referral reward");
  }
}
