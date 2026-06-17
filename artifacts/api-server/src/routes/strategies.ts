import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, strategiesTable, masterAccountsTable } from "@workspace/db";
import { CreateStrategyBody, DeleteStrategyParams } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate";
import { getMetaApiToken } from "../lib/metaapi";

const router = Router();

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

  // Verify the master account belongs to this user
  const [masterAccount] = await db
    .select()
    .from(masterAccountsTable)
    .where(and(eq(masterAccountsTable.id, masterAccountId), eq(masterAccountsTable.userId, req.userId!)));

  if (!masterAccount) {
    res.status(400).json({ error: "Master account not found" });
    return;
  }

  let copyfactoryStrategyId: string | null = null;

  const metaapiToken = await getMetaApiToken();
  if (metaapiToken && masterAccount.metaapiAccountId) {
    try {
      const stratId = `strategy-${Date.now()}`;
      const response = await fetch(
        `https://copyfactory-api-v1.agiliumtrade.agiliumtrade.ai/users/current/configuration/strategies/${stratId}`,
        {
          method: "PUT",
          headers: {
            "auth-token": metaapiToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: strategyName,
            positionLifecycle: "hedging",
            connectionId: masterAccount.metaapiAccountId,
          }),
        }
      );
      if (response.ok) {
        copyfactoryStrategyId = stratId;
      }
    } catch {
      // Continue without MetaApi — store locally
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

  res.status(201).json(strategy);
});

router.delete("/strategies/:id", authenticate, async (req, res): Promise<void> => {
  const params = DeleteStrategyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db
    .delete(strategiesTable)
    .where(and(eq(strategiesTable.id, params.data.id), eq(strategiesTable.userId, req.userId!)));

  res.sendStatus(204);
});

export default router;
