import { Router } from "express";
import { eq, sum, count, asc, desc, isNotNull, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, usersTable, subscriptionsTable, paymentsTable, slaveAccountsTable, strategiesTable, adminSettingsTable, bindingsTable, masterAccountsTable, masterAccountAuditLogsTable, passwordResetTokensTable, referralsTable, promoCodesTable, customerCareSettingsTable, smsQueueTable } from "@workspace/db";
import { SuspendUserParams, ActivateUserParams, UpdateAdminSettingsBody } from "@workspace/api-zod";
import { authenticate, requireAdmin } from "../middlewares/authenticate";
import { notifyAccountSuspended, notifyMasterAccountApproved } from "../lib/smsNotifier";
import { invalidateMetaApiTokenCache, checkAndMarkProviderRole, ensureSlaveSubscriberRole } from "../lib/metaapi";
import { syncCopyFactoryStrategies, getLastSyncReport, repairStrategyCopyFactoryIds } from "../lib/copyfactorySync";
import { getSchedulerStatus, runEnforcementTick, runExpiryWarningTick } from "../lib/scheduler";
import { runPollerNow, writeAuditLog } from "../lib/accountPoller";
import { getAllWorkers, getWorkerSummary, manualRestartWorker } from "../lib/workerRegistry";
import { getRegisteredQueues, clearQueueByName, retryHistoryJob, retryAllFailed } from "../lib/retryQueue";
import { deployMasterToMetaApi, serializeAccount } from "./masterAccounts";
import { serializeAccount as serializeSlaveAccount } from "./slaveAccounts";
import { decryptCredential } from "../lib/auth";

const router = Router();

// Public platform theme endpoint — used by ThemeProvider for unauthenticated visitors
router.get("/platform-theme", async (_req, res): Promise<void> => {
  const [settings] = await db
    .select({ defaultTheme: adminSettingsTable.defaultTheme })
    .from(adminSettingsTable)
    .orderBy(adminSettingsTable.id)
    .limit(1);
  res.json({ defaultTheme: settings?.defaultTheme ?? "dark" });
});

// Public pricing endpoint — no auth required (used by landing page)
router.get("/pricing", async (_req, res): Promise<void> => {
  const [settings] = await db
    .select({ dailyFee: adminSettingsTable.dailyFee, minDays: adminSettingsTable.minDays, maxDays: adminSettingsTable.maxDays })
    .from(adminSettingsTable)
    .orderBy(adminSettingsTable.id)
    .limit(1);
  if (!settings) {
    res.json({ dailyFee: 100, minDays: 1, maxDays: 365 });
    return;
  }
  res.json({ dailyFee: parseFloat(settings.dailyFee as string), minDays: settings.minDays, maxDays: settings.maxDays });
});

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
  const [pendingMasterResult] = await db
    .select({ count: count() })
    .from(masterAccountsTable)
    .where(eq(masterAccountsTable.status, "pending_approval"));

  res.json({
    totalUsers: totalUsersResult.count,
    activeSubscriptions: activeSubsResult.count,
    totalRevenue: parseFloat((revenueResult.total as string) ?? "0"),
    activeSlaveAccounts: slaveCountResult.count,
    activeStrategies: strategyCountResult.count,
    totalPayments: paymentCountResult.count,
    pendingMasterApprovals: pendingMasterResult.count,
  });
});

router.get("/admin/referral-stats", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const [totalResult] = await db.select({ count: count() }).from(referralsTable);
  const [rewardedResult] = await db.select({ count: count() }).from(referralsTable).where(eq(referralsTable.status, "rewarded"));
  const [pendingResult] = await db.select({ count: count() }).from(referralsTable).where(eq(referralsTable.status, "pending"));
  const [totalDaysResult] = await db.select({ total: sum(referralsTable.rewardDays) }).from(referralsTable).where(eq(referralsTable.status, "rewarded"));

  const topCodes = await db
    .select()
    .from(promoCodesTable)
    .orderBy(desc(promoCodesTable.totalReferrals))
    .limit(5);

  const topReferrers = await Promise.all(
    topCodes.map(async (pc) => {
      const [user] = await db.select({ name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, pc.userId)).limit(1);
      return { name: user?.name ?? "Unknown", email: user?.email ?? "", code: pc.code, totalReferrals: pc.totalReferrals, totalRewardDays: pc.totalRewardDays };
    }),
  );

  res.json({
    totalReferrals: totalResult.count,
    rewarded: rewardedResult.count,
    pending: pendingResult.count,
    totalRewardDaysGiven: parseInt(String(totalDaysResult.total ?? "0")),
    topReferrers,
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

  // SMS: account suspended
  if (user.phone) notifyAccountSuspended({ userId: user.id, phone: user.phone, name: user.name });

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

router.get("/admin/settings", authenticate, async (req, res): Promise<void> => {
  const [settings] = await db.select().from(adminSettingsTable).orderBy(adminSettingsTable.id).limit(1);
  if (!settings) {
    const [created] = await db
      .insert(adminSettingsTable)
      .values({ dailyFee: "100", minDays: 1, maxDays: 365 })
      .returning();
    const base = { ...created, dailyFee: parseFloat(created.dailyFee as string) };
    res.json(req.userRole === "admin" ? base : { id: base.id, dailyFee: base.dailyFee, minDays: base.minDays, maxDays: base.maxDays, updatedAt: base.updatedAt });
    return;
  }
  const base = { ...settings, dailyFee: parseFloat(settings.dailyFee as string) };
  res.json(req.userRole === "admin" ? base : { id: base.id, dailyFee: base.dailyFee, minDays: base.minDays, maxDays: base.maxDays, updatedAt: base.updatedAt });
});

router.patch("/admin/settings", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateAdminSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(adminSettingsTable).orderBy(adminSettingsTable.id).limit(1);
  const updates: Partial<typeof adminSettingsTable.$inferInsert> = {};
  if (parsed.data.dailyFee != null) updates.dailyFee = parsed.data.dailyFee.toString();
  if (parsed.data.minDays != null) updates.minDays = parsed.data.minDays;
  if (parsed.data.maxDays != null) updates.maxDays = parsed.data.maxDays;
  if ("metaApiToken" in parsed.data) updates.metaApiToken = parsed.data.metaApiToken ?? null;
  if (parsed.data.expiryWarningDays != null) updates.expiryWarningDays = parsed.data.expiryWarningDays;
  const rawBody = req.body as { defaultTheme?: string; activeStrategyId?: number | null };
  if (rawBody.defaultTheme && ["dark", "light", "system"].includes(rawBody.defaultTheme)) {
    updates.defaultTheme = rawBody.defaultTheme;
  }
  if ("activeStrategyId" in rawBody) {
    updates.activeStrategyId = rawBody.activeStrategyId ?? null;
  }

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

// ─── CopyFactory Strategies ──────────────────────────────────────────────────

router.get("/admin/copyfactory-strategies", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(adminSettingsTable).orderBy(adminSettingsTable.id).limit(1);
  const strategies = await db.select().from(strategiesTable);
  const result = strategies
    .filter((s) => s.copyfactoryStrategyId)
    .map((s) => ({
      copyfactoryStrategyId: s.copyfactoryStrategyId,
      name: s.strategyName,
      localId: s.id,
      masterAccountId: s.masterAccountId,
      status: s.status,
      isActive: settings?.activeStrategyId === s.id,
    }));
  res.json(result);
});

router.post("/admin/copyfactory-strategies/sync", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  try {
    const report = await syncCopyFactoryStrategies();
    res.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Sync failed: ${msg}` });
  }
});

router.get("/admin/copyfactory-strategies/report", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  res.json(getLastSyncReport());
});

// Re-register any strategies that were saved locally but failed to register in CopyFactory
// (e.g. because the old ID format was rejected by the API).
router.post("/admin/copyfactory-strategies/repair", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  try {
    const report = await repairStrategyCopyFactoryIds();
    res.json({ ok: report.failed === 0, ...report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Repair failed: ${msg}` });
  }
});

// Re-register any slave accounts that are missing their CopyFactory subscriber registration.
// Safe to call any time — ensureSlaveSubscriberRole is idempotent (checks first, registers only if absent).
router.post("/admin/copyfactory-subscribers/repair", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  try {
    const slaves = await db
      .select({ id: slaveAccountsTable.id, mt5Login: slaveAccountsTable.mt5Login, copyFactorySubscriberId: slaveAccountsTable.copyFactorySubscriberId })
      .from(slaveAccountsTable)
      .where(isNotNull(slaveAccountsTable.metaapiAccountId));

    const report: { attempted: number; registered: number; alreadyRegistered: number; failed: number; details: object[] } = {
      attempted: 0,
      registered: 0,
      alreadyRegistered: 0,
      failed: 0,
      details: [],
    };

    for (const slave of slaves) {
      report.attempted++;
      const hadId = !!slave.copyFactorySubscriberId;
      try {
        const ok = await ensureSlaveSubscriberRole(slave.id);
        if (hadId) {
          report.alreadyRegistered++;
          report.details.push({ slaveId: slave.id, mt5Login: slave.mt5Login, result: "already_registered" });
        } else if (ok) {
          report.registered++;
          report.details.push({ slaveId: slave.id, mt5Login: slave.mt5Login, result: "registered" });
        } else {
          report.failed++;
          report.details.push({ slaveId: slave.id, mt5Login: slave.mt5Login, result: "failed" });
        }
      } catch (err) {
        report.failed++;
        report.details.push({ slaveId: slave.id, mt5Login: slave.mt5Login, result: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }

    res.json({ ok: report.failed === 0, ...report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Repair failed: ${msg}` });
  }
});

// ─── Master Account Approval ────────────────────────────────────────────────

router.get("/admin/master-accounts", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const accounts = await db.select().from(masterAccountsTable);
  const users = await db.select().from(usersTable);

  const result = accounts.map((a) => {
    const user = users.find((u) => u.id === a.userId);
    return {
      ...serializeAccount(a),
      userEmail: user?.email ?? null,
      userName: user?.name ?? null,
    };
  });

  res.json(result);
});

router.post("/admin/master-accounts/:id/approve", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const rawId = parseInt(String(req.params.id ?? ""), 10);
  if (!rawId || rawId <= 0) {
    res.status(400).json({ error: "Invalid account ID" });
    return;
  }

  const [account] = await db
    .select()
    .from(masterAccountsTable)
    .where(eq(masterAccountsTable.id, rawId));

  if (!account) {
    res.status(404).json({ error: "Master account not found" });
    return;
  }

  if (account.status !== "pending_approval") {
    res.status(400).json({ error: `Account is already ${account.status}` });
    return;
  }

  // Step 1: Mark as APPROVED
  await db
    .update(masterAccountsTable)
    .set({ status: "approved", rejectionReason: null })
    .where(eq(masterAccountsTable.id, account.id));

  await writeAuditLog({
    masterAccountId: account.id,
    userId: account.userId,
    adminId: req.userId!,
    event: "approved",
    fromStatus: "pending_approval",
    toStatus: "approved",
  });

  // Step 2: Trigger MetaApi deployment
  await writeAuditLog({
    masterAccountId: account.id,
    userId: account.userId,
    adminId: req.userId!,
    event: "deployment_started",
    fromStatus: "approved",
    toStatus: "deploying",
  });

  const plainPassword = decryptCredential(account.investorPasswordEncrypted);
  const deployed = await deployMasterToMetaApi({
    mt5Login: account.mt5Login,
    plainPassword,
    server: account.server,
    broker: account.broker,
    platform: account.platform ?? "mt5",
  });

  const [updated] = await db
    .update(masterAccountsTable)
    .set({
      metaapiAccountId: deployed.metaapiAccountId,
      status: deployed.status,
      deploymentStatus: deployed.deploymentStatus,
      lastErrorMessage: deployed.lastErrorMessage,
      metaapiRegion: deployed.metaapiRegion,
    })
    .where(eq(masterAccountsTable.id, account.id))
    .returning();

  await writeAuditLog({
    masterAccountId: account.id,
    userId: account.userId,
    adminId: req.userId!,
    event: deployed.status === "deploying" ? "deployment_success" : "deployment_failed",
    fromStatus: "approved",
    toStatus: deployed.status,
    reason: deployed.lastErrorMessage ?? undefined,
  });

  // SMS: master account approved
  const [acctOwner] = await db.select().from(usersTable).where(eq(usersTable.id, account.userId)).limit(1);
  if (acctOwner?.phone) notifyMasterAccountApproved({ userId: account.userId, phone: acctOwner.phone, name: acctOwner.name, accountId: String(account.mt5Login) });

  res.json({ ...serializeAccount(updated), userEmail: null, userName: null });
});

router.post("/admin/master-accounts/:id/reject", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const rawId = parseInt(String(req.params.id ?? ""), 10);
  if (!rawId || rawId <= 0) {
    res.status(400).json({ error: "Invalid account ID" });
    return;
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    res.status(400).json({ error: "reason is required" });
    return;
  }

  const [account] = await db
    .select()
    .from(masterAccountsTable)
    .where(eq(masterAccountsTable.id, rawId));

  if (!account) {
    res.status(404).json({ error: "Master account not found" });
    return;
  }

  const [updated] = await db
    .update(masterAccountsTable)
    .set({ status: "rejected", rejectionReason: reason })
    .where(eq(masterAccountsTable.id, account.id))
    .returning();

  await writeAuditLog({
    masterAccountId: account.id,
    userId: account.userId,
    adminId: req.userId!,
    event: "rejected",
    fromStatus: account.status,
    toStatus: "rejected",
    reason,
  });

  res.json({ ...serializeAccount(updated), userEmail: null, userName: null });
});

// ─── Scheduler endpoints ─────────────────────────────────────────────────────

router.get("/admin/scheduler-status", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const schedulerStatus = getSchedulerStatus();

  const [activeBindingsResult] = await db
    .select({ count: count() })
    .from(bindingsTable)
    .where(eq(bindingsTable.status, "active"));

  const [totalSubsResult] = await db
    .select({ count: count() })
    .from(subscriptionsTable);

  const [activeSubsResult] = await db
    .select({ count: count() })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.status, "active"));

  const [expiredSubsResult] = await db
    .select({ count: count() })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.status, "expired"));

  res.json({
    ...schedulerStatus,
    activeBindingsTotal: activeBindingsResult.count,
    totalSubscriptionsInDb: totalSubsResult.count,
    activeSubscriptionsInDb: activeSubsResult.count,
    expiredSubscriptionsInDb: expiredSubsResult.count,
  });
});

router.post("/admin/scheduler/run", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  void runEnforcementTick();
  res.json({ message: "Enforcement tick triggered" });
});

router.post("/admin/poller/run", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  void runPollerNow();
  res.json({ message: "Account poller tick triggered" });
});

router.post("/admin/master-accounts/:id/register-provider", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const rawId = parseInt(String(req.params.id ?? ""), 10);
  if (!rawId || rawId <= 0) {
    res.status(400).json({ error: "Invalid account ID" });
    return;
  }

  const [account] = await db
    .select()
    .from(masterAccountsTable)
    .where(eq(masterAccountsTable.id, rawId));

  if (!account) {
    res.status(404).json({ error: "Master account not found" });
    return;
  }

  if (!account.metaapiAccountId) {
    res.status(400).json({ error: "Account has no MetaApi account ID — deploy it first" });
    return;
  }

  const result = await checkAndMarkProviderRole(
    account.id,
    account.metaapiAccountId
  );

  if (result.ok) {
    res.json({ ok: true, message: "CopyFactory provider role confirmed successfully" });
  } else {
    res.status(502).json({ ok: false, error: result.error ?? "Provider role check failed" });
  }
});

router.get("/admin/diagnostics", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const [masters, slaves] = await Promise.all([
    db.select().from(masterAccountsTable),
    db.select().from(slaveAccountsTable),
  ]);

  const users = await db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name }).from(usersTable);
  const userMap = new Map(users.map((u) => [u.id, u]));

  const countBy = <T extends { status: string }>(arr: T[], status: string) =>
    arr.filter((a) => a.status === status).length;

  res.json({
    summary: {
      masters: {
        total: masters.length,
        connected: countBy(masters, "connected"),
        synchronizing: countBy(masters, "synchronizing"),
        connecting: countBy(masters, "connecting"),
        deploying: countBy(masters, "deploying"),
        disconnected: countBy(masters, "disconnected"),
        failed: countBy(masters, "failed"),
        pending_approval: countBy(masters, "pending_approval"),
        pending: countBy(masters, "pending"),
        rejected: countBy(masters, "rejected"),
      },
      slaves: {
        total: slaves.length,
        connected: countBy(slaves, "connected"),
        synchronizing: countBy(slaves, "synchronizing"),
        connecting: countBy(slaves, "connecting"),
        deploying: countBy(slaves, "deploying"),
        disconnected: countBy(slaves, "disconnected"),
        failed: countBy(slaves, "failed"),
        suspended: countBy(slaves, "suspended"),
        pending: countBy(slaves, "pending"),
      },
    },
    masters: masters.map((a) => ({
      ...serializeAccount(a),
      lastCheckedAt: a.lastCheckedAt ?? null,
      userEmail: userMap.get(a.userId)?.email ?? null,
    })),
    slaves: slaves.map((a) => ({
      ...serializeSlaveAccount(a),
      lastCheckedAt: a.lastCheckedAt ?? null,
      userEmail: userMap.get(a.userId)?.email ?? null,
    })),
  });
});

router.get("/admin/integration-status", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(adminSettingsTable).orderBy(adminSettingsTable.id).limit(1);

  const metaApiToken = !!(settings?.metaApiToken ?? process.env.METAAPI_TOKEN);
  const consumerKey = !!process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = !!process.env.MPESA_CONSUMER_SECRET;
  const passkey = !!process.env.MPESA_PASSKEY;
  const shortcode = !!process.env.MPESA_SHORTCODE;
  const webhookSecret = !!process.env.COPYFACTORY_WEBHOOK_SECRET;

  const callbackUrl = !!process.env.MPESA_CALLBACK_URL;

  const mpesaLive = consumerKey && consumerSecret && passkey && shortcode && callbackUrl;

  res.json({
    metaapi: { token: metaApiToken },
    mpesa: { consumerKey, consumerSecret, passkey, shortcode, callbackUrl },
    webhook: { secret: webhookSecret },
    mode: mpesaLive ? "live" : "demo",
  });
});

router.post("/admin/users/:id/generate-reset-link", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const userId = parseInt(req.params.id as string);
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(passwordResetTokensTable).values({ userId: user.id, token, expiresAt });

  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost:5000";
  const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "http";
  const baseUrl = process.env.APP_URL ?? `${proto}://${host}`;
  const resetLink = `${baseUrl}/reset-password?token=${token}`;

  res.json({
    message: `Reset link generated for ${user.email}. It expires in 1 hour.`,
    resetLink,
  });
});

// Public customer care endpoint — no auth required
router.get("/customer-care", async (_req, res): Promise<void> => {
  const [settings] = await db
    .select()
    .from(customerCareSettingsTable)
    .orderBy(customerCareSettingsTable.id)
    .limit(1);

  if (!settings) {
    const [created] = await db
      .insert(customerCareSettingsTable)
      .values({})
      .returning();
    res.json(created);
    return;
  }

  res.json(settings);
});

// ─── CopyFactory Subscriber Overview ────────────────────────────────────────

router.get("/admin/copyfactory-subscribers", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const slaves = await db.select().from(slaveAccountsTable);
  const users = await db.select().from(usersTable);
  const subs = await db.select().from(subscriptionsTable);
  const allBindings = await db.select().from(bindingsTable);
  const allStrategies = await db.select().from(strategiesTable);

  const result = slaves.map((slave) => {
    const user = users.find((u) => u.id === slave.userId);
    const sub = subs.find((s) => s.userId === slave.userId);
    const slaveBindings = allBindings.filter((b) => b.slaveAccountId === slave.id);
    const enrichedBindings = slaveBindings.map((b) => {
      const strategy = allStrategies.find((s) => s.id === b.strategyId);
      return {
        id: b.id,
        strategyId: b.strategyId,
        strategyName: strategy?.strategyName ?? null,
        copyfactoryStrategyId: strategy?.copyfactoryStrategyId ?? null,
        status: b.status,
        riskMultiplier: parseFloat(b.riskMultiplier as string),
        createdAt: b.createdAt,
        lastSyncedAt: b.lastSyncedAt ?? null,
      };
    });

    return {
      slaveAccountId: slave.id,
      mt5Login: slave.mt5Login,
      broker: slave.broker,
      server: slave.server,
      platform: slave.platform,
      slaveStatus: slave.status,
      connectionStatus: slave.connectionStatus ?? null,
      userId: slave.userId,
      userName: user?.name ?? null,
      userEmail: user?.email ?? null,
      copyFactorySubscriberId: slave.copyFactorySubscriberId ?? null,
      copyFactorySubscriberStatus: slave.copyFactorySubscriberStatus ?? null,
      copyFactorySubscriberRegisteredAt: slave.copyFactorySubscriberRegisteredAt ?? null,
      copyFactoryLastSyncedAt: slave.copyFactoryLastSyncedAt ?? null,
      copyFactoryLastError: slave.copyFactoryLastError ?? null,
      subscriptionStatus: sub?.status ?? null,
      subscriptionEndDate: sub?.endDate ?? null,
      bindings: enrichedBindings,
    };
  });

  res.json(result);
});

// ─── CopyFactory Verification Report ────────────────────────────────────────

router.get("/admin/copyfactory-verify", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const masters = await db.select().from(masterAccountsTable);
  const strategies = await db.select().from(strategiesTable);
  const slaves = await db.select().from(slaveAccountsTable);
  const users = await db.select().from(usersTable);
  const subs = await db.select().from(subscriptionsTable);
  const allBindings = await db.select().from(bindingsTable);

  const issues: string[] = [];

  // ── 1. Provider check ──────────────────────────────────────────────────────
  const registeredProviders = masters.filter((m) => m.copyFactoryProviderStatus === "registered");
  const providerOk = registeredProviders.length > 0;
  if (!providerOk) issues.push("No master account is registered as a CopyFactory provider.");

  // ── 2. Strategy check ──────────────────────────────────────────────────────
  const activeWithCfId = strategies.filter((s) => s.status === "active" && s.copyfactoryStrategyId);
  const strategyOk = activeWithCfId.length > 0;
  if (!strategyOk) issues.push("No active strategies have a CopyFactory strategy ID.");
  else if (strategies.some((s) => s.status === "active" && !s.copyfactoryStrategyId)) {
    issues.push("Some active strategies are missing a CopyFactory strategy ID (repair needed).");
  }

  // ── 3. Subscriber check ────────────────────────────────────────────────────
  const slavesWithSub = slaves.filter((s) => s.copyFactorySubscriberId);
  const slavesWithoutSub = slaves.filter((s) => !s.copyFactorySubscriberId && s.metaapiAccountId);
  if (slavesWithoutSub.length > 0) {
    issues.push(`${slavesWithoutSub.length} slave account(s) not yet registered as CopyFactory subscribers.`);
  }

  // ── 4. Binding check ──────────────────────────────────────────────────────
  const activeBindings = allBindings.filter((b) => b.status === "active");
  const suspendedBindings = allBindings.filter((b) => b.status === "suspended");

  // Check subscribers who have an active sub but no active binding
  const activeSubs = subs.filter((s) => s.status === "active" || s.status === "free_trial");
  for (const sub of activeSubs) {
    const userSlaves = slaves.filter((s) => s.userId === sub.userId);
    for (const slave of userSlaves) {
      const hasActiveBinding = activeBindings.some((b) => b.slaveAccountId === slave.id);
      if (!hasActiveBinding && slave.copyFactorySubscriberId) {
        const user = users.find((u) => u.id === slave.userId);
        issues.push(`Slave ${slave.mt5Login} (${user?.email ?? "unknown"}) has active subscription but no active binding.`);
      }
    }
  }

  const subscriberDetails = slaves.map((slave) => {
    const slaveBindings = allBindings.filter((b) => b.slaveAccountId === slave.id);
    const user = users.find((u) => u.id === slave.userId);
    const sub = subs.find((s) => s.userId === slave.userId);
    return {
      slaveAccountId: slave.id,
      mt5Login: slave.mt5Login,
      broker: slave.broker,
      userName: user?.name ?? null,
      subscriberId: slave.copyFactorySubscriberId ?? null,
      subscriberStatus: slave.copyFactorySubscriberStatus ?? null,
      lastSyncedAt: slave.copyFactoryLastSyncedAt ?? null,
      subscriptionStatus: sub?.status ?? null,
      activeBindings: slaveBindings.filter((b) => b.status === "active").length,
      suspendedBindings: slaveBindings.filter((b) => b.status === "suspended").length,
    };
  });

  res.json({
    generatedAt: new Date().toISOString(),
    checks: {
      providerExists: { ok: providerOk, count: registeredProviders.length, accountIds: registeredProviders.map((m) => m.metaapiAccountId) },
      strategiesRegistered: { ok: strategyOk, total: strategies.length, withCfId: activeWithCfId.length, cfIds: activeWithCfId.map((s) => s.copyfactoryStrategyId) },
      subscribersRegistered: { ok: slavesWithoutSub.length === 0, total: slaves.length, registered: slavesWithSub.length, unregistered: slavesWithoutSub.length },
      bindingsActive: { ok: issues.length === 0, total: allBindings.length, active: activeBindings.length, suspended: suspendedBindings.length },
    },
    subscribers: subscriberDetails,
    issues,
    allGreen: issues.length === 0 && providerOk && strategyOk,
  });
});

// ─── Full CopyFactory Audit/Health-Check ─────────────────────────────────────
// GET /admin/copyfactory-audit
// Returns a PASS/FAIL report for every stage of the CopyFactory pipeline:
// Master → Provider role → Strategy (with CF ID) → activeStrategyId → Slave → Subscriber → Binding → Sync
router.get("/admin/copyfactory-audit", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const [settings] = await db.select().from(adminSettingsTable).orderBy(adminSettingsTable.id).limit(1);
  const masters = await db.select().from(masterAccountsTable);
  const strategies = await db.select().from(strategiesTable);
  const slaves = await db.select().from(slaveAccountsTable);
  const subs = await db.select().from(subscriptionsTable);
  const allBindings = await db.select().from(bindingsTable);

  type CheckResult = { pass: boolean; detail: string };
  const checks: Record<string, CheckResult> = {};

  // ── 1. At least one connected master ───────────────────────────────────────
  const connectedMasters = masters.filter((m) => m.status === "connected" || m.status === "synchronizing");
  checks.masterConnected = {
    pass: connectedMasters.length > 0,
    detail: connectedMasters.length > 0
      ? `${connectedMasters.length} master(s) connected`
      : `No master accounts in connected/synchronizing state. Total masters: ${masters.length}`,
  };

  // ── 2. At least one master registered as CopyFactory provider ──────────────
  const registeredProviders = masters.filter((m) => m.copyFactoryProviderStatus === "registered");
  checks.providerRegistered = {
    pass: registeredProviders.length > 0,
    detail: registeredProviders.length > 0
      ? `${registeredProviders.length} master(s) registered as CopyFactory provider`
      : `No master registered as provider. Use Admin > Register Provider.`,
  };

  // ── 3. At least one active strategy with a CopyFactory strategy ID ─────────
  const activeWithCfId = strategies.filter((s) => s.status === "active" && s.copyfactoryStrategyId);
  const activeNoCfId = strategies.filter((s) => s.status === "active" && !s.copyfactoryStrategyId);
  checks.strategyRegistered = {
    pass: activeWithCfId.length > 0,
    detail: activeWithCfId.length > 0
      ? `${activeWithCfId.length} active strategy(ies) have CopyFactory ID${activeNoCfId.length > 0 ? ` (${activeNoCfId.length} still missing CF ID — repair needed)` : ""}`
      : `No active strategies with a CopyFactory ID. Create a strategy or run Repair.`,
  };

  // ── 4. admin_settings.activeStrategyId is populated ────────────────────────
  const activeStratId = settings?.activeStrategyId ?? null;
  const activeStrat = activeStratId != null ? strategies.find((s) => s.id === activeStratId) : null;
  checks.activeStrategySet = {
    pass: activeStratId != null && activeStrat != null,
    detail: activeStratId != null && activeStrat != null
      ? `activeStrategyId=${activeStratId} (${activeStrat.strategyName}, cfId=${activeStrat.copyfactoryStrategyId ?? "MISSING"})`
      : activeStratId != null
        ? `activeStrategyId=${activeStratId} set but strategy not found in DB`
        : `admin_settings.activeStrategyId is NULL — create a strategy to auto-populate it.`,
  };

  // ── 5. Active strategy's CF ID is consistent ──────────────────────────────
  checks.activeStrategyCfIdPresent = {
    pass: activeStrat != null && !!activeStrat.copyfactoryStrategyId,
    detail: activeStrat?.copyfactoryStrategyId
      ? `Active strategy CF ID: ${activeStrat.copyfactoryStrategyId}`
      : `Active strategy is missing copyfactoryStrategyId. Run CopyFactory Repair.`,
  };

  // ── 6. At least one slave deployed ────────────────────────────────────────
  const deployedSlaves = slaves.filter((s) => s.metaapiAccountId);
  checks.slaveDeployed = {
    pass: deployedSlaves.length > 0,
    detail: deployedSlaves.length > 0
      ? `${deployedSlaves.length} slave(s) deployed to MetaApi`
      : `No slaves have a MetaApi account ID. Slaves must be deployed first.`,
  };

  // ── 7. All deployed slaves are registered as CopyFactory subscribers ────────
  const missingSubscriber = deployedSlaves.filter((s) => !s.copyFactorySubscriberId);
  checks.subscribersRegistered = {
    pass: deployedSlaves.length > 0 && missingSubscriber.length === 0,
    detail: missingSubscriber.length === 0
      ? deployedSlaves.length > 0
        ? `All ${deployedSlaves.length} slave(s) registered as CopyFactory subscribers`
        : "No slaves to check"
      : `${missingSubscriber.length} slave(s) not registered as CopyFactory subscriber. Run Subscribers Repair.`,
  };

  // ── 8. Slaves with active subscriptions have active bindings ────────────────
  const activeSubs = subs.filter((s) => s.status === "active" || s.status === "free_trial");
  const slavesWithSubNoBinding: string[] = [];
  for (const sub of activeSubs) {
    const userSlaves = deployedSlaves.filter((s) => s.userId === sub.userId);
    for (const slave of userSlaves) {
      const hasBound = allBindings.some((b) => b.slaveAccountId === slave.id && b.status === "active");
      if (!hasBound) slavesWithSubNoBinding.push(`slave ${slave.mt5Login} (userId=${slave.userId})`);
    }
  }
  checks.bindingsPresent = {
    pass: slavesWithSubNoBinding.length === 0,
    detail: slavesWithSubNoBinding.length === 0
      ? `All active subscribers have at least one active binding`
      : `Missing bindings: ${slavesWithSubNoBinding.join(", ")}`,
  };

  // ── 9. Bindings are synced to CopyFactory (lastSyncedAt not null) ──────────
  const activeBindings = allBindings.filter((b) => b.status === "active");
  const unsyncedBindings = activeBindings.filter((b) => !b.lastSyncedAt);
  checks.bindingsSynced = {
    pass: activeBindings.length > 0 && unsyncedBindings.length === 0,
    detail: activeBindings.length === 0
      ? "No active bindings to check"
      : unsyncedBindings.length === 0
        ? `All ${activeBindings.length} active binding(s) have been synced to CopyFactory`
        : `${unsyncedBindings.length} of ${activeBindings.length} active bindings never synced — trigger syncSlaveSubscriberToCopyFactory for affected slaves`,
  };

  // ── 10. Scheduler/poller running ──────────────────────────────────────────
  const allWorkers = getAllWorkers();
  const schedulerWorker = allWorkers.find((w) => w.id === "subscription-scheduler");
  const schedulerHealthy =
    schedulerWorker != null &&
    schedulerWorker.status !== "failed" &&
    !schedulerWorker.isStale;
  checks.schedulerRunning = {
    pass: schedulerHealthy,
    detail: schedulerHealthy
      ? `Scheduler healthy — last job: ${schedulerWorker!.lastJobCompletedAt ?? "pending first run"}`
      : schedulerWorker == null
        ? "Scheduler worker not registered (server may still be starting up)"
        : schedulerWorker.status === "failed"
          ? `Scheduler worker failed after ${schedulerWorker.consecutiveFailures} consecutive errors — check Worker Dashboard`
          : `Scheduler worker is stale — last job: ${schedulerWorker.lastJobCompletedAt ?? "never"}`,
  };

  const allPass = Object.values(checks).every((c) => c.pass);
  const failedChecks = Object.entries(checks)
    .filter(([, c]) => !c.pass)
    .map(([name, c]) => ({ check: name, detail: c.detail }));

  res.json({
    generatedAt: new Date().toISOString(),
    result: allPass ? "PASS" : "FAIL",
    passCount: Object.values(checks).filter((c) => c.pass).length,
    failCount: failedChecks.length,
    totalChecks: Object.keys(checks).length,
    checks,
    failures: failedChecks,
  });
});

// Admin: get all worker statuses
router.get("/admin/workers", authenticate, requireAdmin, (_req, res): void => {
  const workers = getAllWorkers();
  const summary = getWorkerSummary();
  res.json({ workers, summary });
});

// Admin: manually restart (trigger immediate run of) a worker
router.post("/admin/workers/:id/restart", authenticate, requireAdmin, (req, res): void => {
  const workerId = String(req.params["id"]);
  const success = manualRestartWorker(workerId);
  if (!success) {
    res.status(404).json({ error: "Worker not found or has no restart function" });
    return;
  }
  res.json({ success: true, workerId });
});

// Admin: update customer care settings
router.put("/admin/customer-care", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const { phone1, phone2, whatsapp, email, supportHours } = req.body as {
    phone1?: string;
    phone2?: string | null;
    whatsapp?: string;
    email?: string;
    supportHours?: string;
  };

  const [existing] = await db
    .select({ id: customerCareSettingsTable.id })
    .from(customerCareSettingsTable)
    .orderBy(customerCareSettingsTable.id)
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(customerCareSettingsTable)
      .set({
        ...(phone1 !== undefined && { phone1 }),
        ...(phone2 !== undefined && { phone2 }),
        ...(whatsapp !== undefined && { whatsapp }),
        ...(email !== undefined && { email }),
        ...(supportHours !== undefined && { supportHours }),
      })
      .where(eq(customerCareSettingsTable.id, existing.id))
      .returning();
    res.json(updated);
  } else {
    const [created] = await db
      .insert(customerCareSettingsTable)
      .values({
        phone1: phone1 ?? "",
        phone2: phone2 ?? null,
        whatsapp: whatsapp ?? "",
        email: email ?? "",
        supportHours: supportHours ?? "Mon-Fri 8AM-6PM",
      })
      .returning();
    res.json(created);
  }
});

// ── Master Account Audit Trail ────────────────────────────────────────────────

// GET /admin/master-audit — all masters with user email + audit event count
router.get("/admin/master-audit", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const masters = await db
    .select({
      id: masterAccountsTable.id,
      mt5Login: masterAccountsTable.mt5Login,
      broker: masterAccountsTable.broker,
      status: masterAccountsTable.status,
      platform: masterAccountsTable.platform,
      userId: masterAccountsTable.userId,
      createdAt: masterAccountsTable.createdAt,
      userEmail: usersTable.email,
    })
    .from(masterAccountsTable)
    .leftJoin(usersTable, eq(masterAccountsTable.userId, usersTable.id))
    .orderBy(desc(masterAccountsTable.id));

  const auditCounts = await db
    .select({
      masterAccountId: masterAccountAuditLogsTable.masterAccountId,
      eventCount: sql<number>`count(*)::int`,
    })
    .from(masterAccountAuditLogsTable)
    .groupBy(masterAccountAuditLogsTable.masterAccountId);

  const countMap = new Map<number, number>(auditCounts.map((r) => [r.masterAccountId, r.eventCount]));

  res.json(masters.map((m) => ({ ...m, auditEventCount: countMap.get(m.id) ?? 0 })));
});

// GET /admin/master-audit/:masterAccountId — full audit timeline for one master
router.get("/admin/master-audit/:masterAccountId", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const masterAccountId = parseInt(String(req.params.masterAccountId), 10);
  if (isNaN(masterAccountId)) { res.status(400).json({ error: "Invalid masterAccountId" }); return; }

  const [master] = await db
    .select({
      id: masterAccountsTable.id,
      mt5Login: masterAccountsTable.mt5Login,
      broker: masterAccountsTable.broker,
      status: masterAccountsTable.status,
      platform: masterAccountsTable.platform,
      createdAt: masterAccountsTable.createdAt,
      userEmail: usersTable.email,
    })
    .from(masterAccountsTable)
    .leftJoin(usersTable, eq(masterAccountsTable.userId, usersTable.id))
    .where(eq(masterAccountsTable.id, masterAccountId))
    .limit(1);

  if (!master) { res.status(404).json({ error: "Master account not found" }); return; }

  const logs = await db
    .select()
    .from(masterAccountAuditLogsTable)
    .where(eq(masterAccountAuditLogsTable.masterAccountId, masterAccountId))
    .orderBy(asc(masterAccountAuditLogsTable.createdAt));

  const adminIds = [...new Set(logs.map((l) => l.adminId).filter((id): id is number => id !== null))];
  let adminMap = new Map<number, string>();
  if (adminIds.length > 0) {
    const admins = await db.select({ id: usersTable.id, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, adminIds[0]));
    adminMap = new Map(admins.map((a) => [a.id, a.email]));
  }

  res.json({
    master,
    logs: logs.map((l) => ({
      ...l,
      adminEmail: l.adminId ? (adminMap.get(l.adminId) ?? null) : null,
    })),
  });
});

// ── Retry Queue Inspector ─────────────────────────────────────────────────────

// GET /admin/queues — all registered in-memory retry queues
router.get("/admin/queues", authenticate, requireAdmin, async (_req, res): Promise<void> => {
  const queues = getRegisteredQueues();

  // Also fetch the SMS database queue summary
  const smsStats = await db
    .select({
      status: smsQueueTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(smsQueueTable)
    .groupBy(smsQueueTable.status);

  const smsMap = Object.fromEntries(smsStats.map((r) => [r.status, r.count]));

  const failedSms = await db
    .select({
      id: smsQueueTable.id,
      phone: smsQueueTable.phone,
      eventType: smsQueueTable.eventType,
      attempts: smsQueueTable.attempts,
      lastAttemptAt: smsQueueTable.lastAttemptAt,
      createdAt: smsQueueTable.createdAt,
    })
    .from(smsQueueTable)
    .where(eq(smsQueueTable.status, "failed"))
    .orderBy(desc(smsQueueTable.createdAt))
    .limit(30);

  const pendingSms = await db
    .select({
      id: smsQueueTable.id,
      phone: smsQueueTable.phone,
      eventType: smsQueueTable.eventType,
      attempts: smsQueueTable.attempts,
      scheduledFor: smsQueueTable.scheduledFor,
      createdAt: smsQueueTable.createdAt,
    })
    .from(smsQueueTable)
    .where(eq(smsQueueTable.status, "pending"))
    .orderBy(asc(smsQueueTable.scheduledFor))
    .limit(30);

  res.json({
    queues,
    smsDbQueue: {
      stats: {
        pending: smsMap["pending"] ?? 0,
        sending: smsMap["sending"] ?? 0,
        sent: smsMap["sent"] ?? 0,
        failed: smsMap["failed"] ?? 0,
      },
      pending: pendingSms,
      failed: failedSms,
    },
  });
});

// POST /admin/queues/:name/clear — clear pending jobs from a named in-memory queue
router.post("/admin/queues/:name/clear", authenticate, requireAdmin, (req, res): void => {
  const name = String(req.params.name);
  const ok = clearQueueByName(name);
  if (!ok) { res.status(404).json({ error: `Queue "${name}" not found` }); return; }
  res.json({ success: true });
});

// POST /admin/queues/:name/jobs/:jobId/retry — re-trigger a specific failed job
router.post("/admin/queues/:name/jobs/:jobId/retry", authenticate, requireAdmin, (req, res): void => {
  const name = String(req.params.name);
  const jobId = String(req.params.jobId);
  const ok = retryHistoryJob(name, jobId);
  if (!ok) { res.status(404).json({ error: `Job "${jobId}" not found in queue "${name}"` }); return; }
  res.json({ success: true });
});

// POST /admin/queues/:name/retry-failed — re-trigger all failed jobs in a queue
router.post("/admin/queues/:name/retry-failed", authenticate, requireAdmin, (req, res): void => {
  const name = String(req.params.name);
  const n = retryAllFailed(name);
  res.json({ success: true, count: n });
});

// POST /admin/sms-queue/:id/retry — manually retry a specific failed SMS from the database
router.post("/admin/sms-queue/:id/retry", authenticate, requireAdmin, async (req, res): Promise<void> => {
  const smsId = parseInt(String(req.params.id), 10);
  if (isNaN(smsId)) { res.status(400).json({ error: "Invalid SMS id" }); return; }

  const [sms] = await db.select({ id: smsQueueTable.id, status: smsQueueTable.status }).from(smsQueueTable).where(eq(smsQueueTable.id, smsId)).limit(1);
  if (!sms) { res.status(404).json({ error: "SMS not found" }); return; }

  // Lazy-import to avoid circular dep at module load time
  const { smsManualRetryQueue } = await import("../lib/smsWorker");
  smsManualRetryQueue.enqueue(`sms-${smsId}:${Date.now()}`, `SMS ${smsId} manual retry`, { smsId }, 3);
  res.json({ success: true });
});

export default router;
