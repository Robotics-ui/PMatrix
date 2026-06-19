import { Router } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import { db, tradeLogsTable, strategiesTable } from "@workspace/db";
import { authenticate } from "../middlewares/authenticate";

const router = Router();

function parseNum(v: unknown): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

router.get("/trade-logs", authenticate, async (req, res): Promise<void> => {
  const userStrategies = await db
    .select()
    .from(strategiesTable)
    .where(eq(strategiesTable.userId, req.userId!));

  const strategyIds = userStrategies.map((s) => s.id);

  if (strategyIds.length === 0) {
    res.json([]);
    return;
  }

  const strategyMap = new Map(userStrategies.map((s) => [s.id, s.strategyName]));

  const logs = await db
    .select()
    .from(tradeLogsTable)
    .where(inArray(tradeLogsTable.strategyId, strategyIds))
    .orderBy(desc(tradeLogsTable.createdAt))
    .limit(200);

  res.json(
    logs.map((log) => ({
      id: log.id,
      strategyId: log.strategyId,
      strategyName: strategyMap.get(log.strategyId) ?? null,
      slaveAccountId: log.slaveAccountId ?? null,
      action: log.action,
      symbol: log.symbol ?? null,
      side: log.side ?? null,
      volume: parseNum(log.volume),
      profit: parseNum(log.profit),
      openPrice: parseNum(log.openPrice),
      closePrice: parseNum(log.closePrice),
      transactionId: log.transactionId ?? null,
      details: log.details ?? null,
      createdAt: log.createdAt,
    }))
  );
});

export default router;
