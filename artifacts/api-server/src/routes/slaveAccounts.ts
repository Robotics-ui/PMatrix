import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, slaveAccountsTable, subscriptionsTable } from "@workspace/db";
import { CreateSlaveAccountBody, DeleteSlaveAccountParams, RefreshSlaveAccountStatusParams } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate";
import { encryptCredential } from "../lib/auth";
import { getMetaApiToken, mapMetaApiState } from "../lib/metaapi";
import { logger } from "../lib/logger";

const router = Router();

const PROVISIONING_API = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";

type MetaApiAccountState = {
  id: string;
  state: string;
  connectionStatus: string;
};

export function serializeAccount(a: typeof slaveAccountsTable.$inferSelect) {
  return {
    id: a.id,
    userId: a.userId,
    metaapiAccountId: a.metaapiAccountId,
    subscriberId: a.subscriberId,
    mt5Login: a.mt5Login,
    broker: a.broker,
    server: a.server,
    status: a.status,
    deploymentStatus: a.deploymentStatus ?? null,
    connectionStatus: a.connectionStatus ?? null,
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
  let status = "connecting";
  let deploymentStatus: string | null = null;
  let connectionStatus: string | null = null;

  const metaapiToken = await getMetaApiToken();
  if (metaapiToken) {
    try {
      // Step 1: Create the MetaApi account
      const createResponse = await fetch(`${PROVISIONING_API}/users/current/accounts`, {
        method: "POST",
        headers: {
          "auth-token": metaapiToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          login: mt5Login,
          password: investorPassword,
          server,
          name: `${broker}-${mt5Login}-slave`,
          platform: "mt5",
          type: "cloud-g2",
        }),
      });

      const createData = (await createResponse.json()) as { id?: string; message?: string };

      if (!createData.id) {
        logger.warn({ createData }, "MetaApi slave account creation returned no ID");
        status = "error";
      } else {
        metaapiAccountId = createData.id;
        subscriberId = createData.id;
        logger.info({ metaapiAccountId }, "MetaApi slave account created");

        // Step 2: Deploy the account so MetaApi connects it to the broker
        const deployResponse = await fetch(
          `${PROVISIONING_API}/users/current/accounts/${metaapiAccountId}/deploy`,
          {
            method: "POST",
            headers: { "auth-token": metaapiToken },
          }
        );

        if (deployResponse.ok || deployResponse.status === 204) {
          logger.info({ metaapiAccountId }, "MetaApi slave account deploy triggered");
          status = "deploying";
          deploymentStatus = "DEPLOYING";
        } else {
          const deployData = (await deployResponse.json().catch(() => ({}))) as { message?: string };
          logger.warn({ metaapiAccountId, deployData }, "MetaApi slave deploy returned non-OK");
          status = "connecting";
        }
      }
    } catch (err) {
      logger.error({ err }, "MetaApi slave account creation/deploy error");
      status = "error";
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
    const response = await fetch(
      `${PROVISIONING_API}/users/current/accounts/${account.metaapiAccountId}`,
      { headers: { "auth-token": metaapiToken } }
    );

    if (!response.ok) {
      res.json(serializeAccount(account));
      return;
    }

    const data = (await response.json()) as MetaApiAccountState;
    const newStatus = mapMetaApiState(data.state ?? "");

    const [updated] = await db
      .update(slaveAccountsTable)
      .set({
        status: newStatus,
        deploymentStatus: data.state ?? null,
        connectionStatus: data.connectionStatus ?? null,
        lastCheckedAt: new Date(),
      })
      .where(eq(slaveAccountsTable.id, account.id))
      .returning();

    logger.info(
      { id: account.id, metaapiAccountId: account.metaapiAccountId, state: data.state, connectionStatus: data.connectionStatus },
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

  // Undeploy from MetaApi before deleting if possible
  if (account?.metaapiAccountId) {
    const metaapiToken = await getMetaApiToken();
    if (metaapiToken) {
      await fetch(
        `${PROVISIONING_API}/users/current/accounts/${account.metaapiAccountId}/undeploy`,
        { method: "POST", headers: { "auth-token": metaapiToken } }
      ).catch(() => {});
    }
  }

  await db
    .delete(slaveAccountsTable)
    .where(and(eq(slaveAccountsTable.id, params.data.id), eq(slaveAccountsTable.userId, req.userId!)));

  res.sendStatus(204);
});

export default router;
