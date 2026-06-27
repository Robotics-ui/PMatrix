import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, strategiesTable, masterAccountsTable, bindingsTable, slaveAccountsTable, adminSettingsTable } from "@workspace/db";
import { CreateStrategyBody, DeleteStrategyParams } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate";
import { getMetaApiToken, getCopyFactoryApiBase, syncSlaveSubscriberToCopyFactory, copyfactoryFetch } from "../lib/metaapi";
import { writeAuditLog } from "../lib/accountPoller";
import { logger } from "../lib/logger";

const router = Router();

// Statuses that allow strategy creation (master must be at least deployed by MetaApi)
const STRATEGY_ALLOWED_STATUSES = new Set(["deployed", "strategy_created", "active"]);

// All active platform strategies whose master is CONNECTED + DEPLOYED.
// Any authenticated user can query this — used by the Bindings page so
// subscribers can bind to the admin's strategy without owning it themselves.
router.get("/strategies/available", authenticate, async (_req, res): Promise<void> => {
  const allActive = await db
    .select()
    .from(strategiesTable)
    .where(eq(strategiesTable.status, "active"));

  const BINDABLE_MASTER_STATUSES = new Set(["deployed", "strategy_created", "active"]);

  const result = [];
  for (const strategy of allActive) {
    const [master] = await db
      .select()
      .from(masterAccountsTable)
      .where(eq(masterAccountsTable.id, strategy.masterAccountId));

    if (
      master &&
      BINDABLE_MASTER_STATUSES.has(master.status) &&
      master.connectionStatus === "CONNECTED" &&
      master.deploymentStatus === "DEPLOYED"
    ) {
      result.push(strategy);
    }
  }

  res.json(result);
});

router.get("/strategies", authenticate, async (req, res): Promise<void> => {
  const strategies = await db
    .select()
    .from(strategiesTable)
    .where(eq(strategiesTable.userId, req.userId!));

  res.json(strategies);
});

router.post("/strategies", authenticate, async (req, res): Promise<void> => {
  const parsed = CreateStrategyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { strategyName, masterAccountId } = parsed.data;

  const [masterAccount] = await db
    .select()
    .from(masterAccountsTable)
    .where(and(eq(masterAccountsTable.id, masterAccountId), eq(masterAccountsTable.userId, req.userId!)));

  if (!masterAccount) {
    res.status(400).json({ error: "Master account not found" });
    return;
  }

  if (!STRATEGY_ALLOWED_STATUSES.has(masterAccount.status)) {
    let reason: string;
    switch (masterAccount.status) {
      case "pending_approval":
        reason = "Master account is pending admin approval. Strategies can only be created once the account is deployed.";
        break;
      case "approved":
        reason = "Master account is approved and awaiting deployment to MetaApi. Please wait for deployment to complete.";
        break;
      case "deploying":
      case "connecting":
      case "synchronizing":
        reason = "Master account is currently being deployed. Please wait for deployment to complete.";
        break;
      case "failed":
        reason = "Master account deployment failed. Contact an admin for assistance.";
        break;
      case "rejected":
        reason = "Master account was rejected and cannot be used for strategies.";
        break;
      case "suspended":
        reason = "Master account is suspended. Strategies cannot be created while the account is suspended.";
        break;
      default:
        reason = "Master account is not ready for strategy creation.";
    }
    res.status(400).json({ error: reason });
    return;
  }

  const metaapiToken = await getMetaApiToken();

  // Guard: CopyFactory provider role must be registered before a strategy can be created.
  // This ensures MetaApi recognises the account as a signal source ("provider role").
  // In demo mode (no METAAPI_TOKEN) this check is bypassed.
  if (metaapiToken && masterAccount.metaapiAccountId && masterAccount.copyFactoryProviderStatus !== "registered") {
    const cfStatus = masterAccount.copyFactoryProviderStatus ?? "none";
    const errMsg =
      cfStatus === "failed"
        ? `CopyFactory provider registration previously failed for this account. Use the admin panel to retry. ` +
          `Error: ${masterAccount.copyFactoryLastError ?? "unknown"}`
        : `CopyFactory provider not yet registered for this account (status: ${cfStatus}). ` +
          `The automatic registration runs every 30 seconds — please wait, then try again. ` +
          `If this persists, use the admin panel to trigger manual provider registration.`;
    res.status(422).json({ error: errMsg });
    return;
  }

  let copyfactoryStrategyId: string | null = null;

  if (metaapiToken && masterAccount.metaapiAccountId) {
    // Use the region-specific CopyFactory endpoint.
    // The old global URL (copyfactory-api-v1.agiliumtrade.agiliumtrade.ai) was
    // decommissioned and returns nginx 404. Correct form: copyfactory-api-v1.{region}.agiliumtrade.ai
    const cfBase = getCopyFactoryApiBase(masterAccount.metaapiRegion ?? "vint-hill");
    // CopyFactory strategy IDs must be exactly 4 alphanumeric characters (a-z, 0-9).
    // Longer IDs or those with hyphens are rejected with HTTP 400 ValidationError.
    // The 36^4 = 1.68M ID space is small, so we retry up to 15 times on conflict.
    const genStratId = () =>
      Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
    try {
      let registered = false;
      let lastError = "";
      for (let attempt = 0; attempt < 15 && !registered; attempt++) {
        const stratId = genStratId();
        const response = await copyfactoryFetch(
          "PUT",
          `${cfBase}/users/current/configuration/strategies/${stratId}`,
          metaapiToken,
          {
            name: strategyName,
            description: strategyName,
            accountId: masterAccount.metaapiAccountId,
            positionLifecycle: "hedging",
          }
        );
        if (response.ok) {
          copyfactoryStrategyId = stratId;
          registered = true;
          logger.info({ stratId, masterAccountId, cfBase, attempt }, "CopyFactory strategy created");
        } else {
          const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
          lastError = `HTTP ${response.status}: ${body}`;
          // Retry only on conflict (409) or validation errors that look like ID collisions.
          // Any other error (auth, not-found, etc.) will break out after logging.
          const isConflict = response.status === 409 || (response.status === 400 && body.includes("already exists"));
          if (!isConflict) {
            logger.warn({ status: response.status, stratId, body, cfBase, attempt }, "CopyFactory strategy creation returned non-OK — will not retry");
            break;
          }
          logger.warn({ status: response.status, stratId, attempt }, "CopyFactory strategy ID collision — retrying with new ID");
        }
      }
      if (!registered && copyfactoryStrategyId === null) {
        logger.warn({ lastError, cfBase }, "CopyFactory strategy registration failed after all attempts — saved locally only. Use Admin > Repair to retry.");
      }
    } catch (err) {
      logger.warn({ err }, "CopyFactory strategy creation failed — storing locally only");
    }
  }

  const [strategy] = await db
    .insert(strategiesTable)
    .values({
      userId: req.userId!,
      copyfactoryStrategyId,
      strategyName,
      masterAccountId,
      status: "active",
    })
    .returning();

  // Advance master from 'deployed' → 'strategy_created' when first strategy is created
  if (masterAccount.status === "deployed") {
    await db
      .update(masterAccountsTable)
      .set({ status: "strategy_created" })
      .where(eq(masterAccountsTable.id, masterAccountId));

    await writeAuditLog({
      masterAccountId,
      userId: req.userId!,
      event: "strategy_created",
      fromStatus: "deployed",
      toStatus: "strategy_created",
    });

    logger.info({ masterAccountId }, "Master account advanced to strategy_created after strategy creation");
  }

  // Auto-populate activeStrategyId in admin_settings if it is currently unset
  try {
    const [currentSettings] = await db
      .select({ id: adminSettingsTable.id, activeStrategyId: adminSettingsTable.activeStrategyId })
      .from(adminSettingsTable)
      .orderBy(adminSettingsTable.id)
      .limit(1);

    if (currentSettings && currentSettings.activeStrategyId == null) {
      await db
        .update(adminSettingsTable)
        .set({ activeStrategyId: strategy.id })
        .where(eq(adminSettingsTable.id, currentSettings.id));
      logger.info({ strategyId: strategy.id }, "admin_settings.activeStrategyId auto-populated after strategy creation");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to auto-populate activeStrategyId — non-fatal");
  }

  res.status(201).json(strategy);
});

router.delete("/strategies/:id", authenticate, async (req, res): Promise<void> => {
  const params = DeleteStrategyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [strategy] = await db
    .select()
    .from(strategiesTable)
    .where(and(eq(strategiesTable.id, params.data.id), eq(strategiesTable.userId, req.userId!)));

  if (!strategy) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }

  const affectedBindings = await db
    .select({ slaveAccountId: bindingsTable.slaveAccountId })
    .from(bindingsTable)
    .where(eq(bindingsTable.strategyId, strategy.id));

  const affectedSlaveIds = [...new Set(affectedBindings.map((b: { slaveAccountId: number }) => b.slaveAccountId))] as number[];

  await db.delete(bindingsTable).where(eq(bindingsTable.strategyId, strategy.id));

  await db
    .delete(strategiesTable)
    .where(and(eq(strategiesTable.id, params.data.id), eq(strategiesTable.userId, req.userId!)));

  const metaapiToken = await getMetaApiToken();
  if (metaapiToken && strategy.copyfactoryStrategyId) {
    const [stratMaster] = await db
      .select({ metaapiRegion: masterAccountsTable.metaapiRegion })
      .from(masterAccountsTable)
      .where(eq(masterAccountsTable.id, strategy.masterAccountId));
    const cfBase = getCopyFactoryApiBase(stratMaster?.metaapiRegion ?? "vint-hill");
    copyfactoryFetch(
      "DELETE",
      `${cfBase}/users/current/configuration/strategies/${strategy.copyfactoryStrategyId}`,
      metaapiToken
    ).catch((err) => {
      logger.warn({ err, copyfactoryStrategyId: strategy.copyfactoryStrategyId }, "CopyFactory strategy delete failed");
    });
  }

  for (const slaveId of affectedSlaveIds as number[]) {
    const [slave] = await db.select({ id: slaveAccountsTable.id }).from(slaveAccountsTable).where(eq(slaveAccountsTable.id, slaveId));
    if (slave) {
      await syncSlaveSubscriberToCopyFactory(slaveId).catch((err) => {
        logger.warn({ err, slaveId }, "CopyFactory sync after strategy delete failed");
      });
    }
  }

  res.sendStatus(204);
});

export default router;
