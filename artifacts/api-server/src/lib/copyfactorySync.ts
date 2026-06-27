import { eq, isNull } from "drizzle-orm";
import { db, strategiesTable, masterAccountsTable, usersTable, adminSettingsTable } from "@workspace/db";
import { getMetaApiToken, callMetaApi, getCopyFactoryApiBase, copyfactoryFetch } from "./metaapi";
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

  if (!firstMaster) {
    // No master accounts in the DB yet — skip entirely rather than falling back to "vint-hill"
    // (which would cause ENOTFOUND DNS errors in dev where the region server is unreachable).
    logger.debug("No master accounts in DB — skipping CopyFactory strategy fetch");
    return [];
  }

  const cfBase = getCopyFactoryApiBase(firstMaster.metaapiRegion ?? "vint-hill");

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
  }
}

/**
 * Repair: finds strategies in the DB that have no copyfactoryStrategyId and
 * attempts to register them in CopyFactory using the master account's region.
 * Called at server startup and from admin sync triggers.
 */
export type RepairReport = {
  attempted: number;
  repaired: number;
  failed: number;
  skipped: number;
  details: Array<{ strategyId: number; strategyName: string; result: "repaired" | "failed" | "skipped"; error?: string }>;
};

/**
 * Repair: finds strategies in the DB that have no copyfactoryStrategyId and
 * attempts to register them in CopyFactory using the master account's region.
 * Called at server startup and from the admin /repair endpoint.
 * Returns a structured report of what was attempted and whether it succeeded.
 */
export async function repairStrategyCopyFactoryIds(): Promise<RepairReport> {
  const report: RepairReport = { attempted: 0, repaired: 0, failed: 0, skipped: 0, details: [] };

  const token = await getMetaApiToken();
  if (!token) return report;

  const broken = await db
    .select()
    .from(strategiesTable)
    .where(isNull(strategiesTable.copyfactoryStrategyId));

  if (broken.length === 0) return report;

  logger.info({ count: broken.length }, "Repairing strategies with missing CopyFactory IDs");

  const genStratId = () =>
    Array.from({ length: 4 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

  for (const strategy of broken) {
    report.attempted++;
    const [master] = await db
      .select()
      .from(masterAccountsTable)
      .where(eq(masterAccountsTable.id, strategy.masterAccountId));

    if (!master?.metaapiAccountId) {
      const err = "master has no MetaApi account ID";
      logger.warn({ strategyId: strategy.id }, `Cannot repair strategy — ${err}`);
      report.skipped++;
      report.details.push({ strategyId: strategy.id, strategyName: strategy.strategyName, result: "skipped", error: err });
      continue;
    }

    const cfBase = getCopyFactoryApiBase(master.metaapiRegion ?? "vint-hill");
    let repaired = false;
    let lastError = "";

    try {
      for (let attempt = 0; attempt < 15 && !repaired; attempt++) {
        const stratId = genStratId();
        const response = await copyfactoryFetch(
          "PUT",
          `${cfBase}/users/current/configuration/strategies/${stratId}`,
          token,
          {
            name: strategy.strategyName,
            description: strategy.strategyName,
            accountId: master.metaapiAccountId,
            positionLifecycle: "hedging",
          }
        );
        if (response.ok) {
          await db
            .update(strategiesTable)
            .set({ copyfactoryStrategyId: stratId })
            .where(eq(strategiesTable.id, strategy.id));
          logger.info({ strategyId: strategy.id, stratId, cfBase, attempt }, "Strategy CopyFactory ID repaired");
          repaired = true;
        } else {
          const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
          lastError = `HTTP ${response.status}: ${body}`;
          const isConflict = response.status === 409 || (response.status === 400 && body.includes("already exists"));
          if (!isConflict) {
            logger.warn({ strategyId: strategy.id, status: response.status, body, cfBase, attempt }, "Strategy CopyFactory repair failed — non-retryable error");
            break;
          }
          logger.warn({ strategyId: strategy.id, stratId, attempt }, "CopyFactory strategy ID collision during repair — retrying");
        }
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      logger.warn({ err, strategyId: strategy.id }, "Strategy CopyFactory repair network error");
    }

    if (repaired) {
      report.repaired++;
      report.details.push({ strategyId: strategy.id, strategyName: strategy.strategyName, result: "repaired" });

      // Auto-populate activeStrategyId if still unset after repair
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
          logger.info({ strategyId: strategy.id }, "admin_settings.activeStrategyId auto-populated after strategy repair");
        }
      } catch (err) {
        logger.warn({ err }, "Failed to auto-populate activeStrategyId during repair — non-fatal");
      }
    } else {
      report.failed++;
      report.details.push({ strategyId: strategy.id, strategyName: strategy.strategyName, result: "failed", error: lastError });
    }
  }

  return report;
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
