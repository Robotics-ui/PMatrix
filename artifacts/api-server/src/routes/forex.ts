import { Router } from "express";
import { db, bannerSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate, requireAdmin } from "../middlewares/authenticate";
import { logger } from "../lib/logger";

const router = Router();

interface CachedRates {
  baseRates: Record<string, number>;
  previousRates: Record<string, number> | null;
  fetchedAt: number;
}

let ratesCache: CachedRates | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

const PAIR_CONFIG: Record<string, { spreadPips: number; pipSize: number; precision: number }> = {
  "EUR/USD": { spreadPips: 1.2, pipSize: 0.0001, precision: 5 },
  "GBP/USD": { spreadPips: 1.5, pipSize: 0.0001, precision: 5 },
  "USD/JPY": { spreadPips: 1.5, pipSize: 0.01,   precision: 3 },
  "USD/CHF": { spreadPips: 1.8, pipSize: 0.0001, precision: 5 },
  "AUD/USD": { spreadPips: 1.5, pipSize: 0.0001, precision: 5 },
  "NZD/USD": { spreadPips: 2.5, pipSize: 0.0001, precision: 5 },
  "USD/CAD": { spreadPips: 2.0, pipSize: 0.0001, precision: 5 },
  "EUR/GBP": { spreadPips: 1.8, pipSize: 0.0001, precision: 5 },
  "EUR/JPY": { spreadPips: 2.5, pipSize: 0.01,   precision: 3 },
  "GBP/JPY": { spreadPips: 3.0, pipSize: 0.01,   precision: 3 },
};

function computePairMid(pair: string, rates: Record<string, number>): number {
  const [base, quote] = pair.split("/") as [string, string];
  if (base === "USD") return rates[quote] ?? 1;
  if (quote === "USD") return 1 / (rates[base] ?? 1);
  return (rates[quote] ?? 1) / (rates[base] ?? 1);
}

function getMarketStatus(): "OPEN" | "CLOSED" | "OPENING_SOON" {
  const now = new Date();
  const day = now.getUTCDay();
  const totalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  if (day === 6) return "CLOSED";
  if (day === 0) {
    if (totalMinutes >= 22 * 60) return "OPEN";
    if (totalMinutes >= 21 * 60 + 30) return "OPENING_SOON";
    return "CLOSED";
  }
  if (day === 5 && totalMinutes >= 22 * 60) return "CLOSED";
  return "OPEN";
}

async function fetchBaseRates(): Promise<Record<string, number>> {
  const res = await fetch(
    "https://api.frankfurter.app/latest?base=USD&symbols=EUR,GBP,JPY,CHF,AUD,NZD,CAD",
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
  const data = (await res.json()) as { rates: Record<string, number> };
  return data.rates;
}

function buildRates(
  baseRates: Record<string, number>,
  prevRates: Record<string, number> | null,
  selectedPairs: string[]
) {
  return selectedPairs
    .filter((p) => p in PAIR_CONFIG)
    .map((pair) => {
      const config = PAIR_CONFIG[pair]!;
      const baseMid = computePairMid(pair, baseRates);
      const fluctuation = (Math.random() - 0.5) * config.pipSize * 3;
      const mid = baseMid + fluctuation;

      const spreadValue = config.spreadPips * config.pipSize;
      const bid = mid - spreadValue / 2;
      const ask = mid + spreadValue / 2;

      let changePercent: number;
      let change: number;

      if (prevRates) {
        const prevMid = computePairMid(pair, prevRates);
        change = mid - prevMid;
        changePercent = (change / prevMid) * 100;
      } else {
        changePercent = (Math.random() - 0.48) * 0.5;
        change = baseMid * (changePercent / 100);
      }

      const direction =
        changePercent > 0.001 ? "up" : changePercent < -0.001 ? "down" : "neutral";

      return {
        pair,
        bid: parseFloat(bid.toFixed(config.precision)),
        ask: parseFloat(ask.toFixed(config.precision)),
        spread: parseFloat(spreadValue.toFixed(config.precision + 1)),
        midPrice: parseFloat(mid.toFixed(config.precision)),
        change: parseFloat(change.toFixed(config.precision)),
        changePercent: parseFloat(changePercent.toFixed(4)),
        direction,
      };
    });
}

router.get("/forex/rates", async (_req, res): Promise<void> => {
  try {
    const now = Date.now();

    if (!ratesCache || now - ratesCache.fetchedAt > CACHE_TTL_MS) {
      const previousRates = ratesCache?.baseRates ?? null;
      const baseRates = await fetchBaseRates();
      ratesCache = { baseRates, previousRates, fetchedAt: now };
    }

    let settings;
    try {
      [settings] = await db.select().from(bannerSettingsTable).limit(1);
    } catch { /* ignore DB error, use all pairs */ }

    const selectedPairs: string[] = settings?.selectedPairs
      ? (JSON.parse(settings.selectedPairs) as string[])
      : Object.keys(PAIR_CONFIG);

    res.json({
      rates: buildRates(ratesCache.baseRates, ratesCache.previousRates, selectedPairs),
      marketStatus: getMarketStatus(),
      cachedAt: new Date(ratesCache.fetchedAt).toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch forex rates");

    if (ratesCache) {
      const all = Object.keys(PAIR_CONFIG);
      res.json({
        rates: buildRates(ratesCache.baseRates, null, all),
        marketStatus: getMarketStatus(),
        cachedAt: new Date(ratesCache.fetchedAt).toISOString(),
        isStale: true,
      });
      return;
    }

    res.status(503).json({ error: "Market data temporarily unavailable" });
  }
});

router.get("/forex/banner-settings", async (_req, res): Promise<void> => {
  try {
    let [settings] = await db.select().from(bannerSettingsTable).limit(1);
    if (!settings) {
      [settings] = await db.insert(bannerSettingsTable).values({}).returning();
    }
    res.json({ ...settings, selectedPairs: JSON.parse(settings.selectedPairs) as string[] });
  } catch (err) {
    logger.error({ err }, "Failed to get banner settings");
    res.status(500).json({ error: "Failed to get banner settings" });
  }
});

router.patch("/forex/banner-settings", authenticate, requireAdmin, async (req, res): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (typeof body.displayMode === "string") patch.displayMode = body.displayMode;
    if (typeof body.backgroundColor === "string") patch.backgroundColor = body.backgroundColor;
    if (typeof body.primaryColor === "string") patch.primaryColor = body.primaryColor;
    if (typeof body.secondaryColor === "string") patch.secondaryColor = body.secondaryColor;
    if (typeof body.textColor === "string") patch.textColor = body.textColor;
    if (typeof body.bullishColor === "string") patch.bullishColor = body.bullishColor;
    if (typeof body.bearishColor === "string") patch.bearishColor = body.bearishColor;
    if (typeof body.fontFamily === "string") patch.fontFamily = body.fontFamily;
    if (typeof body.fontSize === "number") patch.fontSize = body.fontSize;
    if (typeof body.bannerHeight === "number") patch.bannerHeight = body.bannerHeight;
    if (typeof body.tickerSpeed === "number") patch.tickerSpeed = body.tickerSpeed;
    if (typeof body.refreshRate === "number") patch.refreshRate = body.refreshRate;
    if (Array.isArray(body.selectedPairs)) patch.selectedPairs = JSON.stringify(body.selectedPairs);

    let [settings] = await db.select().from(bannerSettingsTable).limit(1);

    if (!settings) {
      [settings] = await db.insert(bannerSettingsTable).values(patch).returning();
    } else {
      [settings] = await db
        .update(bannerSettingsTable)
        .set(patch)
        .where(eq(bannerSettingsTable.id, settings.id))
        .returning();
    }

    res.json({ ...settings, selectedPairs: JSON.parse(settings.selectedPairs) as string[] });
  } catch (err) {
    logger.error({ err }, "Failed to update banner settings");
    res.status(500).json({ error: "Failed to update banner settings" });
  }
});

export default router;
