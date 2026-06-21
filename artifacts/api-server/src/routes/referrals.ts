import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  promoCodesTable,
  referralsTable,
  referralSettingsTable,
  usersTable,
  notificationsTable,
} from "@workspace/db";
import { authenticate, requireAdmin } from "../middlewares/authenticate";

const router = Router();

// ── User: my referral dashboard ──────────────────────────────────────────────

router.get("/referrals/my", authenticate, async (req, res): Promise<void> => {
  const userId = req.userId!;

  const [promoCode] = await db
    .select()
    .from(promoCodesTable)
    .where(eq(promoCodesTable.userId, userId))
    .limit(1);

  if (!promoCode) {
    res.json({
      promoCode: null,
      totalReferrals: 0,
      pendingRewards: 0,
      totalRewardDays: 0,
      referredUsers: [],
    });
    return;
  }

  const allReferrals = await db
    .select()
    .from(referralsTable)
    .where(eq(referralsTable.referrerId, userId))
    .orderBy(desc(referralsTable.createdAt));

  const pendingRewards = allReferrals.filter((r) => r.status === "pending").length;

  const referredUsers = await Promise.all(
    allReferrals.map(async (ref) => {
      const [user] = await db
        .select({ name: usersTable.name, email: usersTable.email, createdAt: usersTable.createdAt })
        .from(usersTable)
        .where(eq(usersTable.id, ref.referredUserId))
        .limit(1);
      return {
        referralId: ref.id,
        name: user?.name ?? "Unknown",
        email: user?.email ?? "",
        joinedAt: user?.createdAt ?? null,
        status: ref.status,
        rewardDays: ref.rewardDays ?? 0,
        rewardedAt: ref.rewardedAt ?? null,
      };
    }),
  );

  res.json({
    promoCode: promoCode.code,
    totalReferrals: promoCode.totalReferrals,
    pendingRewards,
    totalRewardDays: promoCode.totalRewardDays,
    referredUsers,
  });
});

// ── User: get current reward milestones (public for logged-in users) ──────────

router.get(
  "/referrals/settings",
  authenticate,
  async (_req, res): Promise<void> => {
    const settings = await db
      .select()
      .from(referralSettingsTable)
      .orderBy(referralSettingsTable.referralsRequired);
    res.json(settings);
  },
);

// ── User: in-app notifications ───────────────────────────────────────────────

router.get("/notifications", authenticate, async (req, res): Promise<void> => {
  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.userId!))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  res.json(notifications);
});

router.patch(
  "/notifications/:id/read",
  authenticate,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid notification id" });
      return;
    }
    await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.id, id),
          eq(notificationsTable.userId, req.userId!),
        ),
      );
    res.json({ ok: true });
  },
);

router.post(
  "/notifications/read-all",
  authenticate,
  async (req, res): Promise<void> => {
    await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(eq(notificationsTable.userId, req.userId!));
    res.json({ ok: true });
  },
);

// ── Admin: manage referral reward milestones ──────────────────────────────────

router.get(
  "/admin/referral-settings",
  authenticate,
  requireAdmin,
  async (_req, res): Promise<void> => {
    const settings = await db
      .select()
      .from(referralSettingsTable)
      .orderBy(referralSettingsTable.referralsRequired);
    res.json(settings);
  },
);

router.post(
  "/admin/referral-settings",
  authenticate,
  requireAdmin,
  async (req, res): Promise<void> => {
    const { referralsRequired, rewardDays, isEnabled } = req.body as {
      referralsRequired?: unknown;
      rewardDays?: unknown;
      isEnabled?: unknown;
    };

    const reqCount = parseInt(String(referralsRequired));
    const reward = parseInt(String(rewardDays));

    if (isNaN(reqCount) || reqCount < 1) {
      res.status(400).json({ error: "referralsRequired must be a positive integer" });
      return;
    }
    if (isNaN(reward) || reward < 1) {
      res.status(400).json({ error: "rewardDays must be a positive integer" });
      return;
    }

    const [created] = await db
      .insert(referralSettingsTable)
      .values({
        referralsRequired: reqCount,
        rewardDays: reward,
        isEnabled: isEnabled !== false,
      })
      .returning();

    res.status(201).json(created);
  },
);

router.patch(
  "/admin/referral-settings/:id",
  authenticate,
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { referralsRequired, rewardDays, isEnabled } = req.body as {
      referralsRequired?: unknown;
      rewardDays?: unknown;
      isEnabled?: unknown;
    };

    const updates: Partial<{
      referralsRequired: number;
      rewardDays: number;
      isEnabled: boolean;
    }> = {};

    if (referralsRequired !== undefined) {
      const v = parseInt(String(referralsRequired));
      if (isNaN(v) || v < 1) {
        res.status(400).json({ error: "Invalid referralsRequired" });
        return;
      }
      updates.referralsRequired = v;
    }
    if (rewardDays !== undefined) {
      const v = parseInt(String(rewardDays));
      if (isNaN(v) || v < 1) {
        res.status(400).json({ error: "Invalid rewardDays" });
        return;
      }
      updates.rewardDays = v;
    }
    if (isEnabled !== undefined) updates.isEnabled = Boolean(isEnabled);

    const [updated] = await db
      .update(referralSettingsTable)
      .set(updates)
      .where(eq(referralSettingsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Setting not found" });
      return;
    }
    res.json(updated);
  },
);

router.delete(
  "/admin/referral-settings/:id",
  authenticate,
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    await db
      .delete(referralSettingsTable)
      .where(eq(referralSettingsTable.id, id));
    res.sendStatus(204);
  },
);

export default router;
