import { Router } from "express";
import { eq, sum, count } from "drizzle-orm";
import { db, usersTable, subscriptionsTable, paymentsTable, slaveAccountsTable, strategiesTable, adminSettingsTable } from "@workspace/db";
import { SuspendUserParams, ActivateUserParams, UpdateAdminSettingsBody } from "@workspace/api-zod";
import { authenticate, requireAdmin } from "../middlewares/authenticate";
import { invalidateMetaApiTokenCache } from "../lib/metaapi";

const router = Router();

router.get("/admin/stats", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const [totalUsersResult] = await db.select({ count: count() }).from(usersTable);
  const [activeSubsResult] = await db
    .select({ count: count() })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.status, "active"));
  const [revenueResult] = await db
    .select({ total: sum(paymentsTable.amount) })
    .from(paymentsTable)
    .where(eq(paymentsTable.status, "completed"));
  const [slaveCountResult] = await db.select({ count: count() }).from(slaveAccountsTable);
  const [strategyCountResult] = await db.select({ count: count() }).from(strategiesTable);
  const [paymentCountResult] = await db.select({ count: count() }).from(paymentsTable);

  res.json({
    totalUsers: totalUsersResult.count,
    activeSubscriptions: activeSubsResult.count,
    totalRevenue: parseFloat(revenueResult.total as string ?? "0"),
    activeSlaveAccounts: slaveCountResult.count,
    activeStrategies: strategyCountResult.count,
    totalPayments: paymentCountResult.count,
  });
});

router.get("/admin/users", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable);
  const subs = await db.select().from(subscriptionsTable);

  function countRemainingTradingDays(endDate: Date | null): number {
    if (!endDate) return 0;
    const now = new Date();
    if (now >= endDate) return 0;
    let count = 0;
    const cursor = new Date(now);
    cursor.setHours(0, 0, 0, 0);
    while (cursor < endDate) {
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) count++;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }

  const result = users.map((u) => {
    const sub = subs.find((s) => s.userId === u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      status: u.status,
      subscriptionStatus: sub?.status ?? null,
      remainingDays: sub ? countRemainingTradingDays(sub.endDate ?? null) : null,
      createdAt: u.createdAt,
    };
  });

  res.json(result);
});

router.patch("/admin/users/:id/suspend", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const params = SuspendUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ status: "suspended" })
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const sub = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
  const s = sub[0];

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    subscriptionStatus: s?.status ?? null,
    remainingDays: null,
    createdAt: user.createdAt,
  });
});

router.patch("/admin/users/:id/activate", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const params = ActivateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ status: "active" })
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const sub = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
  const s = sub[0];

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    subscriptionStatus: s?.status ?? null,
    remainingDays: null,
    createdAt: user.createdAt,
  });
});

router.get("/admin/payments", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const payments = await db.select().from(paymentsTable);
  res.json(payments.map((p) => ({ ...p, amount: parseFloat(p.amount as string) })));
});

router.get("/admin/settings", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(adminSettingsTable).limit(1);
  if (!settings) {
    const [created] = await db
      .insert(adminSettingsTable)
      .values({ dailyFee: "100", minDays: 1, maxDays: 365 })
      .returning();
    res.json({ ...created, dailyFee: parseFloat(created.dailyFee as string) });
    return;
  }
  res.json({ ...settings, dailyFee: parseFloat(settings.dailyFee as string) });
});

router.patch("/admin/settings", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateAdminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(adminSettingsTable).limit(1);
  const updates: Partial<typeof adminSettingsTable.$inferInsert> = {};
  if (parsed.data.dailyFee != null) updates.dailyFee = parsed.data.dailyFee.toString();
  if (parsed.data.minDays != null) updates.minDays = parsed.data.minDays;
  if (parsed.data.maxDays != null) updates.maxDays = parsed.data.maxDays;
  if ("metaApiToken" in parsed.data) updates.metaApiToken = parsed.data.metaApiToken ?? null;

  let settings;
  if (!existing) {
    const [created] = await db
      .insert(adminSettingsTable)
      .values({ dailyFee: (parsed.data.dailyFee ?? 100).toString(), minDays: parsed.data.minDays ?? 1, maxDays: parsed.data.maxDays ?? 365, metaApiToken: parsed.data.metaApiToken ?? null })
      .returning();
    settings = created;
  } else {
    const [updated] = await db
      .update(adminSettingsTable)
      .set(updates)
      .where(eq(adminSettingsTable.id, existing.id))
      .returning();
    settings = updated;
  }

  invalidateMetaApiTokenCache();

  res.json({ ...settings, dailyFee: parseFloat(settings.dailyFee as string) });
});

export default router;
