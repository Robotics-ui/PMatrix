import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, slaveAccountsTable, subscriptionsTable } from "@workspace/db";
import { CreateSlaveAccountBody, DeleteSlaveAccountParams } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate";
import { encryptCredential } from "../lib/auth";
import { getMetaApiToken } from "../lib/metaapi";

const router = Router();

router.get("/slave-accounts", authenticate, async (req, res): Promise<void> => {
  const accounts = await db
    .select()
    .from(slaveAccountsTable)
    .where(eq(slaveAccountsTable.userId, req.userId!));

  res.json(
    accounts.map((a) => ({
      id: a.id,
      userId: a.userId,
      metaapiAccountId: a.metaapiAccountId,
      subscriberId: a.subscriberId,
      mt5Login: a.mt5Login,
      broker: a.broker,
      server: a.server,
      status: a.status,
      createdAt: a.createdAt,
    }))
  );
});

router.post("/slave-accounts", authenticate, async (req, res): Promise<void> => {
  const parsed = CreateSlaveAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Check active subscription
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

  const metaapiToken = await getMetaApiToken();
  if (metaapiToken) {
    try {
      // Create MetaApi account
      const accountResponse = await fetch(
        "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts",
        {
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
        }
      );
      const accountData = (await accountResponse.json()) as { id?: string };
      if (accountData.id) {
        metaapiAccountId = accountData.id;
        subscriberId = accountData.id;
        status = "connected";
      }
    } catch {
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
    })
    .returning();

  res.status(201).json({
    id: account.id,
    userId: account.userId,
    metaapiAccountId: account.metaapiAccountId,
    subscriberId: account.subscriberId,
    mt5Login: account.mt5Login,
    broker: account.broker,
    server: account.server,
    status: account.status,
    createdAt: account.createdAt,
  });
});

router.delete("/slave-accounts/:id", authenticate, async (req, res): Promise<void> => {
  const params = DeleteSlaveAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db
    .delete(slaveAccountsTable)
    .where(and(eq(slaveAccountsTable.id, params.data.id), eq(slaveAccountsTable.userId, req.userId!)));

  res.sendStatus(204);
});

export default router;
