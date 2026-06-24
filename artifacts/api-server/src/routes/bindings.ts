import { Router } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, bindingsTable, subscriptionsTable, slaveAccountsTable, strategiesTable, masterAccountsTable } from "@workspace/db";
import { CreateBindingBody, DeleteBindingParams } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate";
import { requireActiveSubscription } from "../middlewares/requireActiveSubscription";
import { syncSlaveSubscriberToCopyFactory, ensureSlaveSubscriberRole } from "../lib/metaapi";

const router = Router();

router.get("/bindings", authenticate, requireActiveSubscription, async (req, res): Promise<void> => {
  const userStrategies = await db
    .select()
    .from(strategiesTable)
    .where(eq(strategiesTable.userId, req.userId!));

  const strategyIds = userStrategies.map((s) => s.id);

  if (strategyIds.length === 0) {
    res.json([]);
    return;
  }

  const allBindings = await db
    .select()
    .from(bindingsTable)
    .where(inArray(bindingsTable.strategyId, strategyIds));

  res.json(
    allBindings.map((b) => ({
      ...b,
      riskMultiplier: parseFloat(b.riskMultiplier as string),
    }))
  );
});

router.post("/bindings", authenticate, async (req, res): Promise<void> => {
  const parsed = CreateBindingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { strategyId, slaveAccountId, riskMultiplier } = parsed.data;

  // Check active subscription
  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, req.userId!));

  if (!sub || (sub.status !== "active" && sub.status !== "free_trial")) {
    res.status(400).json({ error: "Active subscription or free trial required to bind accounts" });
    return;
  }

  // Verify strategy belongs to user
  const [strategy] = await db
    .select()
    .from(strategiesTable)
    .where(and(eq(strategiesTable.id, strategyId), eq(strategiesTable.userId, req.userId!)));

  if (!strategy) {
    res.status(400).json({ error: "Strategy not found" });
    return;
  }

  // Verify master account is ACTIVE with healthy connection before allowing any binding
  const [master] = await db
    .select()
    .from(masterAccountsTable)
    .where(eq(masterAccountsTable.id, strategy.masterAccountId));

  const masterIsActive =
    master &&
    master.status === "active" &&
    master.connectionStatus === "CONNECTED" &&
    master.deploymentStatus === "DEPLOYED";

  if (!masterIsActive) {
    res.status(400).json({
      error: "This strategy is not yet active and cannot accept subscribers.",
    });
    return;
  }

  // Verify strategy itself is active
  if (strategy.status !== "active") {
    res.status(400).json({
      error: "This strategy is not yet active and cannot accept subscribers.",
    });
    return;
  }

  // Verify slave account belongs to user
  const [slave] = await db
    .select()
    .from(slaveAccountsTable)
    .where(and(eq(slaveAccountsTable.id, slaveAccountId), eq(slaveAccountsTable.userId, req.userId!)));

  if (!slave) {
    res.status(400).json({ error: "Slave account not found" });
    return;
  }

  const [binding] = await db
    .insert(bindingsTable)
    .values({
      strategyId,
      slaveAccountId,
      riskMultiplier: riskMultiplier.toString(),
      status: "active",
    })
    .returning();

  // Ensure subscriber role is registered before syncing subscriptions.
  // Auto-fixes any missing CopyFactory registration before the binding takes effect.
  await ensureSlaveSubscriberRole(slaveAccountId);
  await syncSlaveSubscriberToCopyFactory(slaveAccountId);

  res.status(201).json({
    ...binding,
    riskMultiplier: parseFloat(binding.riskMultiplier as string),
  });
});

router.delete("/bindings/:id", authenticate, async (req, res): Promise<void> => {
  const params = DeleteBindingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [existing] = await db
    .select({ id: bindingsTable.id, slaveAccountId: bindingsTable.slaveAccountId, strategyId: bindingsTable.strategyId })
    .from(bindingsTable)
    .where(eq(bindingsTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Binding not found" });
    return;
  }

  const [ownerStrategy] = await db
    .select({ id: strategiesTable.id })
    .from(strategiesTable)
    .where(and(eq(strategiesTable.id, existing.strategyId), eq(strategiesTable.userId, req.userId!)));

  if (!ownerStrategy) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.delete(bindingsTable).where(eq(bindingsTable.id, params.data.id));

  await syncSlaveSubscriberToCopyFactory(existing.slaveAccountId);

  res.sendStatus(204);
});

export default router;
