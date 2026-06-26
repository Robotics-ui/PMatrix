import { eq, isNull } from "drizzle-orm";
import { db, strategiesTable, masterAccountsTable, usersTable } from "@workspace/db";
import { getMetaApiToken, callMetaApi, getCopyFactoryApiBase } from "./metaapi";
import { logger } from "./logger";

export type CopyFactoryStrategyRecord = {
  _id: string;
  name: string;
  positionLifecycle?: string;
  connectionId?: string;
};

export type StrategySyncEntry = {
  copyfactoryStrategyId: string;
  name: string;
  localId: number | null;
  isNew: boolean;
};

export type StrategySyncReport = {
  syncedAt: string;
  durationMs: number;
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
  errors: string[];
  strategies: StrategySyncEntry[];
};

let lastReport: StrategySyncReport | null = null;

export function getLastSyncReport(): StrategySyncReport | null {
  return lastReport;
}

export async function fetchCopyFactoryStrategies(): Promise<CopyFactoryStrategyRecord[]> {
  const token = await getMetaApiToken();
  if (!token) {
    logger.debug("No MetaApi token — skipping CopyFactory strategy fetch");
    return [];
  }

  // Use the first master account's region to construct the correct regional URL.
  // The old global URL (copyfactory-api-v1.agiliumtrade.agiliumtrade.ai) is decommissioned.
  const [firstMaster] = await db
    .select({ metaapiRegion: masterAccountsTable.metaapiRegion })
    .from(masterAccountsTable)
    .limit(1);
  const cfBase = getCopyFactoryApiBase(firstMaster?.metaapiRegion ?? "vint-hill");

  const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  try {
    const result = await callMetaApi<CopyFactoryStrategyRecord[]>(
      "GET",
      `${cfBase}/users/current/configuration/strategies`,
      token
    );
    if (!result.ok) {
      logger.warn({ status: result.status, body: result.data, cfBase }, "CopyFactory GET strategies returned non-OK");
      return [];
    }
    const data = result.data;
    return Array.isArray(data) ? data : [];
  } catch (err) {
    logger.error({ err }, "CopyFactory strategy fetch network error");
    return [];
  } finally {
    if (prevTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
  }
}

/**
 * Repair: finds strategies in the DB that have no copyfactoryStrategyId and
 * attempts to register them in CopyFactory using the master account's region.
 * Called at server startup and from admin sync triggers.
 */
export async function repairStrategyCopyFactoryIds(): Promise<void> {
  const token = await getMetaApiToken();
  if (!token) return;

  const broken = await db
    .select()
    .from(strategiesTable)
    .where(isNull(strategiesTable.copyfactoryStrategyId));

  if (broken.length === 0) return;

  logger.info({ count: broken.length }, "Repairing strategies with missing CopyFactory IDs");

  for (const strategy of broken) {
    const [master] = await db
      .select()
      .from(masterAccountsTable)
      .where(eq(masterAccountsTable.id, strategy.masterAccountId));

    if (!master?.metaapiAccountId) {
      logger.warn({ strategyId: strategy.id }, "Cannot repair strategy — master has no MetaApi account ID");
      continue;
    }

    const cfBase = getCopyFactoryApiBase(master.metaapiRegion ?? "vint-hill");
    const stratId = `strategy-${Date.now()}`;

    const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    try {
      const response = await fetch(
        `${cfBase}/users/current/configuration/strategies/${stratId}`,
        {
          method: "PUT",
          headers: { "auth-token": token, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: strategy.strategyName,
            positionLifecycle: "hedging",
            connectionId: master.metaapiAccountId,
          }),
        }
      );
      if (response.ok) {
        await db
          .update(strategiesTable)
          .set({ copyfactoryStrategyId: stratId })
          .where(eq(strategiesTable.id, strategy.id));
        logger.info({ strategyId: strategy.id, stratId, cfBase }, "Strategy CopyFactory ID repaired");
      } else {
        const body = await response.text().catch(() => "");
        logger.warn({ strategyId: strategy.id, status: response.status, body, cfBase }, "Strategy CopyFactory repair failed");
      }
    } catch (err) {
      logger.warn({ err, strategyId: strategy.id }, "Strategy CopyFactory repair network error");
    } finally {
      if (prevTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    }
  }
}

export async function syncCopyFactoryStrategies(): Promise<StrategySyncReport> {
  const startedAt = Date.now();
  const report: StrategySyncReport = {
    syncedAt: new Date().toISOString(),
    durationMs: 0,
    fetched: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    errors: [],
    strategies: [],
  };

  try {
    const cfStrategies = await fetchCopyFactoryStrategies();
    report.fetched = cfStrategies.length;

    const dbStrategies = await db.select().from(strategiesTable);
    const dbByCfId = new Map(
      dbStrategies
        .filter((s) => s.copyfactoryStrategyId)
        .map((s) => [s.copyfactoryStrategyId!, s])
    );

    const allMasters = await db.select().from(masterAccountsTable);
    const masterByMetaApiId = new Map(
      allMasters
        .filter((m) => m.metaapiAccountId)
        .map((m) => [m.metaapiAccountId!, m])
    );

    const cfStrategyIds = new Set(cfStrategies.map((s) => s._id));

    for (const cfStrategy of cfStrategies) {
      try {
        const existing = dbByCfId.get(cfStrategy._id);

        if (existing) {
          if (existing.strategyName !== cfStrategy.name || existing.status === "inactive") {
            await db
              .update(strategiesTable)
              .set({ strategyName: cfStrategy.name, status: "active" })
              .where(eq(strategiesTable.id, existing.id));
            report.updated++;
            logger.info({ localId: existing.id, cfId: cfStrategy._id }, "CopyFactory strategy updated in DB");
          }
          report.strategies.push({
            copyfactoryStrategyId: cfStrategy._id,
            name: cfStrategy.name,
            localId: existing.id,
            isNew: false,
          });
        } else {
          const master = cfStrategy.connectionId
            ? masterByMetaApiId.get(cfStrategy.connectionId)
            : null;

          // If no master account matches the CF connectionId, look for a master account
          // whose metaapiAccountId we can use. Fall back to the first master in the DB
          // (typically the admin's master), then further fall back to the admin user so
          // that strategies created directly in CopyFactory can still be imported.
          let resolvedMaster = master;
          let resolvedUserId: number | null = null;

          if (!resolvedMaster) {
            if (allMasters.length > 0) {
              resolvedMaster = allMasters[0];
              logger.warn(
                { cfId: cfStrategy._id, connectionId: cfStrategy.connectionId, fallbackMasterId: resolvedMaster.id },
                "No master matched CF connectionId — falling back to first master in DB"
              );
            } else {
              // No masters at all — fall back to the admin user without a master account
              const [adminUser] = await db
                .select({ id: usersTable.id })
                .from(usersTable)
                .where(eq(usersTable.role, "admin"))
                .limit(1);

              if (adminUser) {
                resolvedUserId = adminUser.id;
                logger.warn(
                  { cfId: cfStrategy._id, connectionId: cfStrategy.connectionId },
                  "No master accounts in DB — cannot import CF strategy without a master account. Skipped."
                );
              }

              // Cannot create a strategy without a masterAccountId — skip
              const msg = `Strategy ${cfStrategy._id} ("${cfStrategy.name}") skipped: no master accounts exist in the DB. Add a master account first, then re-sync.`;
              report.errors.push(msg);
              report.strategies.push({
                copyfactoryStrategyId: cfStrategy._id,
                name: cfStrategy.name,
                localId: null,
                isNew: true,
              });
              continue;
            }
          }

          const [created] = await db
            .insert(strategiesTable)
            .values({
              userId: resolvedUserId ?? resolvedMaster!.userId,
              copyfactoryStrategyId: cfStrategy._id,
              strategyName: cfStrategy.name,
              masterAccountId: resolvedMaster!.id,
              status: "active",
            })
            .returning();

          report.created++;
          logger.info({ localId: created.id, cfId: cfStrategy._id }, "CopyFactory strategy imported into DB");
          report.strategies.push({
            copyfactoryStrategyId: cfStrategy._id,
            name: cfStrategy.name,
            localId: created.id,
            isNew: true,
          });
        }
      } catch (err) {
        const msg = `Failed to sync strategy ${cfStrategy._id}: ${String(err)}`;
        report.errors.push(msg);
        logger.error({ err, cfId: cfStrategy._id }, msg);
      }
    }

    for (const dbStrategy of dbStrategies) {
      if (
        dbStrategy.copyfactoryStrategyId &&
        !cfStrategyIds.has(dbStrategy.copyfactoryStrategyId) &&
        dbStrategy.status === "active"
      ) {
        try {
          await db
            .update(strategiesTable)
            .set({ status: "inactive" })
            .where(eq(strategiesTable.id, dbStrategy.id));
          report.deactivated++;
          logger.info(
            { localId: dbStrategy.id, cfId: dbStrategy.copyfactoryStrategyId },
            "Strategy marked inactive — no longer in CopyFactory"
          );
        } catch (err) {
          report.errors.push(`Failed to deactivate strategy ${dbStrategy.id}: ${String(err)}`);
        }
      }
    }
  } catch (err) {
    const msg = `Fatal sync error: ${String(err)}`;
    report.errors.push(msg);
    logger.error({ err }, "CopyFactory strategy sync fatal error");
  }

  report.durationMs = Date.now() - startedAt;
  lastReport = report;
  logger.info(
    {
      fetched: report.fetched,
      created: report.created,
      updated: report.updated,
      deactivated: report.deactivated,
      errors: report.errors.length,
    },
    "CopyFactory strategy sync complete"
  );
  return report;
}
