import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, slaveAccountsTable, subscriptionsTable } from "@workspace/db";
import { CreateSlaveAccountBody, DeleteSlaveAccountParams, RefreshSlaveAccountStatusParams } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate";
import { encryptCredential } from "../lib/auth";
import { getMetaApiToken, callMetaApi, mapMetaApiState } from "../lib/metaapi";
import { logger } from "../lib/logger";

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

export function serializeAccount(a: typeof slaveAccountsTable.$inferSelect) {
  return {
    id: a.id,
    userId: a.userId,
    metaapiAccountId: a.metaapiAccountId ?? null,
    subscriberId: a.subscriberId ?? null,
    mt5Login: a.mt5Login,
    broker: a.broker,
    server: a.server,
    status: a.status,
    deploymentStatus: a.deploymentStatus ?? null,
    connectionStatus: a.connectionStatus ?? null,
    synchronizationStatus: a.synchronizationStatus ?? null,
    lastErrorMessage: a.lastErrorMessage ?? null,
    metaapiRegion: a.metaapiRegion ?? null,
    lastCheckedAt: a.lastCheckedAt ?? null,
    createdAt: a.createdAt,
  };
}

router.get("/slave-accounts", authenticate, async (req, res): Promise<void> => {
  const accounts = await db
    .select()
    .from(slaveAccountsTable)
    .where(eq(slaveAccountsTable.userId, req.userId!));

  res.json(accounts.map(serializeAccount));
});

router.post("/slave-accounts", authenticate, async (req, res): Promise<void> => {
  const parsed = CreateSlaveAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, req.userId!));

  if (!sub || sub.status !== "active") {
    res.status(400).json({ error: "Active subscription required to add slave accounts" });
    return;
  }

  const { broker, server, mt5Login, investorPassword } = parsed.data;

  let metaapiAccountId: string | null = null;
  let subscriberId: string | null = null;
  let status = "pending";
  let deploymentStatus: string | null = null;
  let connectionStatus: string | null = null;
  let synchronizationStatus: string | null = null;
  let lastErrorMessage: string | null = null;
  let metaapiRegion: string | null = null;

  const metaapiToken = await getMetaApiToken();
  if (!metaapiToken) {
    lastErrorMessage = "MetaApi token is not configured. The account will be deployed once the token is added in Admin → Settings.";
    logger.warn({ mt5Login, userId: req.userId }, "MetaApi token not set — slave account created in pending state");
  } else {
    try {
      // ── Step 1: Create the MetaApi account ──────────────────────────────
      const createResult = await callMetaApi<MetaApiAccountState>(
        "POST",
        `${PROVISIONING_API}/users/current/accounts`,
        metaapiToken,
        {
          login: mt5Login,
          password: investorPassword,
          server,
          name: `${broker}-${mt5Login}-slave`,
          platform: "mt5",
          type: "cloud-g2",
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
        logger.error({ httpStatus: createResult.status, body: createResult.data }, "MetaApi slave account creation failed");
        status = "failed";
        lastErrorMessage = `Account creation failed: ${errMsg}`;
      } else {
        metaapiAccountId = createResult.data.id!;
        subscriberId = metaapiAccountId;
        metaapiRegion = createResult.data.region ?? null;
        logger.info({ metaapiAccountId, region: metaapiRegion }, "MetaApi slave account created in MetaApi");

        // ── Step 2: Deploy the account ──────────────────────────────────
        const deployResult = await callMetaApi(
          "POST",
          `${PROVISIONING_API}/users/current/accounts/${metaapiAccountId}/deploy`,
          metaapiToken
        );

        if (deployResult.ok || deployResult.status === 204) {
          logger.info({ metaapiAccountId }, "MetaApi slave account deploy triggered");
          status = "deploying";
          deploymentStatus = "DEPLOYING";
        } else {
          const deployData = deployResult.data as { message?: string } | null;
          const errMsg = deployData?.message ?? `Deploy HTTP ${deployResult.status}`;
          logger.error({ metaapiAccountId, httpStatus: deployResult.status, body: deployResult.data }, "MetaApi slave deploy call failed");
          status = "failed";
          lastErrorMessage = `Deploy failed: ${errMsg}`;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, "MetaApi slave account creation/deploy error");
      status = "failed";
      lastErrorMessage = `Network error: ${msg}`;
    }
  }

  const [account] = await db
    .insert(slaveAccountsTable)
    .values({
      userId: req.userId!,
      metaapiAccountId,
      subscriberId,
      mt5Login,
      broker,
      server,
      investorPasswordEncrypted: encryptCredential(investorPassword),
      status,
      deploymentStatus,
      connectionStatus,
      synchronizationStatus,
      lastErrorMessage,
      metaapiRegion,
    })
    .returning();

  res.status(201).json(serializeAccount(account));
});

router.get("/slave-accounts/:id/refresh-status", authenticate, async (req, res): Promise<void> => {
  const params = RefreshSlaveAccountStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [account] = await db
    .select()
    .from(slaveAccountsTable)
    .where(and(eq(slaveAccountsTable.id, params.data.id), eq(slaveAccountsTable.userId, req.userId!)));

  if (!account) {
    res.status(404).json({ error: "Slave account not found" });
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
    const newStatus = mapMetaApiState(data.state ?? "");

    const [updated] = await db
      .update(slaveAccountsTable)
      .set({
        status: newStatus,
        deploymentStatus: data.state ?? null,
        connectionStatus: data.connectionStatus ?? null,
        synchronizationStatus: data.synchronizationStatus ?? null,
        metaapiRegion: data.region ?? null,
        lastErrorMessage: newStatus === "failed" ? (data.message ?? "Account in FAILED state") : null,
        lastCheckedAt: new Date(),
      })
      .where(eq(slaveAccountsTable.id, account.id))
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
      "MetaApi slave status refreshed"
    );

    res.json(serializeAccount(updated));
  } catch (err) {
    logger.error({ err }, "MetaApi slave status refresh error");
    res.json(serializeAccount(account));
  }
});

router.delete("/slave-accounts/:id", authenticate, async (req, res): Promise<void> => {
  const params = DeleteSlaveAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [account] = await db
    .select()
    .from(slaveAccountsTable)
    .where(and(eq(slaveAccountsTable.id, params.data.id), eq(slaveAccountsTable.userId, req.userId!)));

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
    .delete(slaveAccountsTable)
    .where(and(eq(slaveAccountsTable.id, params.data.id), eq(slaveAccountsTable.userId, req.userId!)));

  res.sendStatus(204);
});

export default router;
