import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, masterAccountsTable } from "@workspace/db";
import { CreateMasterAccountBody, GetMasterAccountParams, DeleteMasterAccountParams } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate";
import { encryptCredential } from "../lib/auth";
import { getMetaApiToken, callMetaApi, mapMetaApiState, registerMasterAsProvider } from "../lib/metaapi";
import { logger } from "../lib/logger";
import { writeAuditLog } from "../lib/accountPoller";

const router = Router();

const PROVISIONING_API = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";

type MetaApiAccountState = {
  id?: string;
  state?: string;
  connectionStatus?: string;
  synchronizationStatus?: string;
  region?: string;
  message?: string;
};

export function serializeAccount(a: typeof masterAccountsTable.$inferSelect) {
  return {
    id: a.id,
    userId: a.userId,
    metaapiAccountId: a.metaapiAccountId ?? null,
    platform: a.platform,
    mt5Login: a.mt5Login,
    broker: a.broker,
    server: a.server,
    status: a.status,
    deploymentStatus: a.deploymentStatus ?? null,
    connectionStatus: a.connectionStatus ?? null,
    synchronizationStatus: a.synchronizationStatus ?? null,
    lastErrorMessage: a.lastErrorMessage ?? null,
    metaapiRegion: a.metaapiRegion ?? null,
    rejectionReason: a.rejectionReason ?? null,
    lastCheckedAt: a.lastCheckedAt ?? null,
    createdAt: a.createdAt,
    copyFactoryProviderId: a.copyFactoryProviderId ?? null,
    copyFactoryProviderStatus: a.copyFactoryProviderStatus ?? null,
    copyFactoryProviderRegisteredAt: a.copyFactoryProviderRegisteredAt ?? null,
    copyFactoryLastApiResponse: a.copyFactoryLastApiResponse ?? null,
    copyFactoryLastError: a.copyFactoryLastError ?? null,
  };
}

/**
 * Deploy a MetaApi account.
 * Called from the admin approval route.
 * Returns the fields to store in the DB.
 */
export async function deployMasterToMetaApi(params: {
  mt5Login: string;
  plainPassword: string;
  server: string;
  broker: string;
  platform?: string;
}): Promise<{
  metaapiAccountId: string | null;
  status: string;
  deploymentStatus: string | null;
  lastErrorMessage: string | null;
  metaapiRegion: string | null;
  copyFactoryProviderStatus: string | null;
}> {
  const metaapiToken = await getMetaApiToken();
  if (!metaapiToken) {
    logger.warn("MetaApi token not configured — cannot deploy master account");
    return {
      metaapiAccountId: null,
      status: "pending",
      deploymentStatus: null,
      lastErrorMessage: "MetaApi token is not configured. Configure it in Admin → Settings.",
      metaapiRegion: null,
      copyFactoryProviderStatus: null,
    };
  }

  try {
    // ── Step 1: Create account ─────────────────────────────────────────────
    const createResult = await callMetaApi<MetaApiAccountState>(
      "POST",
      `${PROVISIONING_API}/users/current/accounts`,
      metaapiToken,
      {
        login: params.mt5Login,
        password: params.plainPassword,
        server: params.server,
        name: `${params.broker}-${params.mt5Login}`,
        platform: params.platform === "mt4" ? "mt4" : "mt5",
        type: params.platform === "mt4" ? "cloud-g1" : "cloud-g2",
        magic: Math.floor(Math.random() * 900000) + 100000,
        reliability: "regular",
      }
    );

    if (!createResult.ok || !createResult.data.id) {
      const errMsg =
        (typeof createResult.data === "object" && createResult.data !== null
          ? (createResult.data as { message?: string }).message
          : String(createResult.data)) ??
        `HTTP ${createResult.status}`;
      logger.error({ httpStatus: createResult.status, body: createResult.data }, "MetaApi account creation failed");
      return {
        metaapiAccountId: null,
        status: "failed",
        deploymentStatus: null,
        lastErrorMessage: `Account creation failed: ${errMsg}`,
        metaapiRegion: null,
      };
    }

    const metaapiAccountId = createResult.data.id!;
    const metaapiRegion = createResult.data.region ?? null;
    logger.info({ metaapiAccountId, region: metaapiRegion }, "MetaApi master account created");

    // ── Step 2: Deploy account ─────────────────────────────────────────────
    const deployResult = await callMetaApi(
      "POST",
      `${PROVISIONING_API}/users/current/accounts/${metaapiAccountId}/deploy`,
      metaapiToken
    );

    if (deployResult.ok || deployResult.status === 204) {
      logger.info({ metaapiAccountId }, "MetaApi master account deploy triggered");
      return {
        metaapiAccountId,
        status: "deploying",
        deploymentStatus: "DEPLOYING",
        lastErrorMessage: null,
        metaapiRegion,
      };
    } else {
      const deployData = deployResult.data as { message?: string } | null;
      const errMsg = deployData?.message ?? `Deploy HTTP ${deployResult.status}`;
      logger.error({ metaapiAccountId, httpStatus: deployResult.status, body: deployResult.data }, "MetaApi deploy call failed");
      return {
        metaapiAccountId,
        status: "failed",
        deploymentStatus: null,
        lastErrorMessage: `Deploy failed: ${errMsg}`,
        metaapiRegion,
      };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "MetaApi account creation/deploy error");
    return {
      metaapiAccountId: null,
      status: "failed",
      deploymentStatus: null,
      lastErrorMessage: `Network error: ${msg}`,
      metaapiRegion: null,
    };
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

router.get("/master-accounts", authenticate, async (req, res): Promise<void> => {
  const accounts = await db
    .select()
    .from(masterAccountsTable)
    .where(eq(masterAccountsTable.userId, req.userId!));

  res.json(accounts.map(serializeAccount));
});

/**
 * Create a master account record.
 * Submission goes to PENDING_APPROVAL — no MetaApi deployment happens here.
 * An admin must approve the account before it is deployed and made active.
 */
router.post("/master-accounts", authenticate, async (req, res): Promise<void> => {
  const parsed = CreateMasterAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { broker, server, mt5Login, investorPassword, platform = "mt5" } = parsed.data;

  const [account] = await db
    .insert(masterAccountsTable)
    .values({
      userId: req.userId!,
      metaapiAccountId: null,
      platform,
      mt5Login,
      broker,
      server,
      investorPasswordEncrypted: encryptCredential(investorPassword),
      status: "pending_approval",
      deploymentStatus: null,
      connectionStatus: null,
      synchronizationStatus: null,
      lastErrorMessage: null,
      metaapiRegion: null,
      rejectionReason: null,
    })
    .returning();

  logger.info({ id: account.id, mt5Login, userId: req.userId }, "Master account submitted for approval");

  await writeAuditLog({
    masterAccountId: account.id,
    userId: req.userId!,
    event: "submitted",
    fromStatus: null,
    toStatus: "pending_approval",
  });

  res.status(201).json(serializeAccount(account));
});

router.get("/master-accounts/:id/refresh-status", authenticate, async (req, res): Promise<void> => {
  const params = GetMasterAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [account] = await db
    .select()
    .from(masterAccountsTable)
    .where(and(eq(masterAccountsTable.id, params.data.id), eq(masterAccountsTable.userId, req.userId!)));

  if (!account) {
    res.status(404).json({ error: "Master account not found" });
    return;
  }

  if (!account.metaapiAccountId) {
    res.json(serializeAccount(account));
    return;
  }

  const metaapiToken = await getMetaApiToken();
  if (!metaapiToken) {
    res.json(serializeAccount(account));
    return;
  }

  try {
    const result = await callMetaApi<MetaApiAccountState>(
      "GET",
      `${PROVISIONING_API}/users/current/accounts/${account.metaapiAccountId}`,
      metaapiToken
    );

    if (!result.ok) {
      res.json(serializeAccount(account));
      return;
    }

    const data = result.data;

    // For lifecycle-managed statuses, never regress via mapMetaApiState.
    // The poller / health-monitor owns transitions for these statuses.
    const LIFECYCLE_MANAGED = new Set(["deployed", "strategy_created", "active", "suspended"]);
    let newStatus: string;
    if (LIFECYCLE_MANAGED.has(account.status)) {
      const state = (data.state ?? "").toUpperCase();
      const conn = (data.connectionStatus ?? "").toUpperCase();
      const isConnected = state === "CONNECTED" || (state === "DEPLOYED" && conn === "CONNECTED");
      const isLost =
        state === "FAILED" ||
        state === "DISCONNECTED" ||
        state === "DISCONNECTING" ||
        conn === "DISCONNECTED";

      if (account.status === "active" && isLost) {
        newStatus = "suspended";
      } else if (account.status === "suspended" && isConnected) {
        newStatus = "active";
      } else {
        newStatus = account.status; // keep managed status unchanged
      }
    } else {
      newStatus = mapMetaApiState(data.state ?? "");
    }

    const [updated] = await db
      .update(masterAccountsTable)
      .set({
        status: newStatus,
        deploymentStatus: data.state ?? null,
        connectionStatus: data.connectionStatus ?? null,
        synchronizationStatus: data.synchronizationStatus ?? null,
        metaapiRegion: data.region ?? null,
        lastErrorMessage: newStatus === "failed" ? (data.message ?? "Account in FAILED state") : null,
        lastCheckedAt: new Date(),
      })
      .where(eq(masterAccountsTable.id, account.id))
      .returning();

    logger.info(
      {
        id: account.id,
        metaapiAccountId: account.metaapiAccountId,
        state: data.state,
        connectionStatus: data.connectionStatus,
        synchronizationStatus: data.synchronizationStatus,
        region: data.region,
      },
      "MetaApi master status refreshed"
    );

    res.json(serializeAccount(updated));
  } catch (err) {
    logger.error({ err }, "MetaApi master status refresh error");
    res.json(serializeAccount(account));
  }
});

router.get("/master-accounts/:id", authenticate, async (req, res): Promise<void> => {
  const params = GetMasterAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [account] = await db
    .select()
    .from(masterAccountsTable)
    .where(and(eq(masterAccountsTable.id, params.data.id), eq(masterAccountsTable.userId, req.userId!)));

  if (!account) {
    res.status(404).json({ error: "Master account not found" });
    return;
  }

  res.json(serializeAccount(account));
});

router.delete("/master-accounts/:id", authenticate, async (req, res): Promise<void> => {
  const params = DeleteMasterAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [account] = await db
    .select()
    .from(masterAccountsTable)
    .where(and(eq(masterAccountsTable.id, params.data.id), eq(masterAccountsTable.userId, req.userId!)));

  if (account?.metaapiAccountId) {
    const metaapiToken = await getMetaApiToken();
    if (metaapiToken) {
      await callMetaApi(
        "POST",
        `${PROVISIONING_API}/users/current/accounts/${account.metaapiAccountId}/undeploy`,
        metaapiToken
      ).catch(() => {});
    }
  }

  await db
    .delete(masterAccountsTable)
    .where(and(eq(masterAccountsTable.id, params.data.id), eq(masterAccountsTable.userId, req.userId!)));

  res.sendStatus(204);
});

export default router;
