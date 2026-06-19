import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, tradeLogsTable, strategiesTable, slaveAccountsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();

/**
 * POST /webhooks/copyfactory
 *
 * Receives trade execution events from MetaApi CopyFactory.
 * Register this URL in your MetaApi CopyFactory strategy/subscriber listener:
 *   https://<your-domain>/api/webhooks/copyfactory?secret=<COPYFACTORY_WEBHOOK_SECRET>
 *
 * If COPYFACTORY_WEBHOOK_SECRET is not set, all requests are accepted (dev/demo mode).
 */
router.post("/webhooks/copyfactory", async (req, res): Promise<void> => {
  const secret = process.env.COPYFACTORY_WEBHOOK_SECRET;
  if (secret && req.query.secret !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = req.body as Record<string, unknown>;

    logger.info({ payload }, "CopyFactory webhook received");

    const copyfactoryStrategyId =
      (payload.strategyId as string | undefined) ??
      (payload.strategy_id as string | undefined);

    const subscriberId =
      (payload.subscriberId as string | undefined) ??
      (payload.subscriber_id as string | undefined);

    const deal = payload.deal as Record<string, unknown> | undefined;

    if (!copyfactoryStrategyId) {
      // Health-check ping — acknowledge and move on
      res.json({ received: true });
      return;
    }

    // ── Extract structured trade data ─────────────────────────────────────
    // CopyFactory may send the fields at the top level OR nested under "deal"
    const rawType =
      (deal?.type as string | undefined) ??
      (payload.type as string | undefined) ??
      "EVENT";

    const transactionId =
      (payload.id as string | undefined) ??
      (deal?.id as string | undefined) ??
      null;

    const symbol =
      (deal?.symbol as string | undefined) ??
      (payload.symbol as string | undefined) ??
      null;

    const rawVolume =
      (deal?.volume as number | string | undefined) ??
      (payload.volume as number | string | undefined) ??
      null;
    const volume = rawVolume != null ? String(rawVolume) : null;

    const rawProfit =
      (deal?.profit as number | string | undefined) ??
      (payload.profit as number | string | undefined) ??
      null;
    const profit = rawProfit != null ? String(rawProfit) : null;

    const rawOpenPrice =
      (deal?.entryPrice as number | string | undefined) ??
      (deal?.openPrice as number | string | undefined) ??
      (payload.openPrice as number | string | undefined) ??
      null;
    const openPrice = rawOpenPrice != null ? String(rawOpenPrice) : null;

    const rawClosePrice =
      (deal?.exitPrice as number | string | undefined) ??
      (deal?.closePrice as number | string | undefined) ??
      (payload.closePrice as number | string | undefined) ??
      null;
    const closePrice = rawClosePrice != null ? String(rawClosePrice) : null;

    // Derive a clean action label
    const action = rawType
      .replace("DEAL_TYPE_", "")
      .replace("ORDER_TYPE_", "")
      .replace("COPYFACTORY_STRATEGY_", "");

    // Derive side (BUY / SELL / null for non-directional events)
    let side: string | null = null;
    if (rawType.includes("BUY")) side = "BUY";
    else if (rawType.includes("SELL")) side = "SELL";

    // ── Deduplication ─────────────────────────────────────────────────────
    if (transactionId) {
      const [existing] = await db
        .select({ id: tradeLogsTable.id })
        .from(tradeLogsTable)
        .where(eq(tradeLogsTable.transactionId, transactionId));

      if (existing) {
        logger.info({ transactionId }, "CopyFactory: duplicate transaction skipped");
        res.json({ received: true });
        return;
      }
    }

    // ── Resolve internal strategy ─────────────────────────────────────────
    const [strategy] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.copyfactoryStrategyId, copyfactoryStrategyId));

    if (!strategy) {
      logger.warn({ copyfactoryStrategyId }, "Webhook: unknown CopyFactory strategy ID");
      res.json({ received: true });
      return;
    }

    // ── Resolve slave account ─────────────────────────────────────────────
    let slaveAccountId: number | null = null;
    if (subscriberId) {
      const [slave] = await db
        .select()
        .from(slaveAccountsTable)
        .where(eq(slaveAccountsTable.subscriberId, subscriberId));
      if (slave) slaveAccountId = slave.id;
    }

    // ── Persist full raw payload for audit ───────────────────────────────
    const details = JSON.stringify({
      transactionId,
      symbol,
      volume: rawVolume,
      profit: rawProfit,
      openPrice: rawOpenPrice,
      closePrice: rawClosePrice,
      entryType: deal?.entryType ?? null,
      time: payload.time ?? new Date().toISOString(),
      rawType,
    });

    await db.insert(tradeLogsTable).values({
      strategyId: strategy.id,
      slaveAccountId,
      action,
      symbol,
      side,
      volume,
      profit,
      openPrice,
      closePrice,
      transactionId,
      details,
    });

    logger.info(
      { strategyId: strategy.id, slaveAccountId, action, symbol, side, volume, profit, transactionId },
      "CopyFactory trade event logged"
    );

    res.json({ received: true });
  } catch (err) {
    logger.error({ err }, "CopyFactory webhook processing error");
    // Always 200 — prevents MetaApi from retrying endlessly
    res.json({ received: true, error: "Processing failed" });
  }
});

export default router;
