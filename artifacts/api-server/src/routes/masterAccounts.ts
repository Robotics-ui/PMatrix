import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, masterAccountsTable } from "@workspace/db";
import { CreateMasterAccountBody, GetMasterAccountParams, DeleteMasterAccountParams } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate";
import { encryptCredential } from "../lib/auth";
import { getMetaApiToken } from "../lib/metaapi";

const router = Router();

router.get("/master-accounts", authenticate, async (req, res): Promise<void> => {
  const accounts = await db
    .select()
    .from(masterAccountsTable)
    .where(eq(masterAccountsTable.userId, req.userId!));

  res.json(
    accounts.map((a) => ({
      id: a.id,
      userId: a.userId,
      metaapiAccountId: a.metaapiAccountId,
      mt5Login: a.mt5Login,
      broker: a.broker,
      server: a.server,
      status: a.status,
      createdAt: a.createdAt,
    }))
  );
});

router.post("/master-accounts", authenticate, async (req, res): Promise<void> => {
  const parsed = CreateMasterAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { broker, server, mt5Login, investorPassword } = parsed.data;

  // In production: call MetaApi to create account and get metaapiAccountId
  // For now, store encrypted credentials and simulate MetaApi integration
  const metaapiToken = await getMetaApiToken();
  let metaapiAccountId: string | null = null;
  let status = "connecting";

  if (metaapiToken) {
    try {
      const response = await fetch("https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts", {
        method: "POST",
        headers: {
          "auth-token": metaapiToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          login: mt5Login,
          password: investorPassword,
          server,
          name: `${broker}-${mt5Login}`,
          platform: "mt5",
          type: "cloud-g2",
        }),
      });
      const data = (await response.json()) as { id?: string };
      if (data.id) {
        metaapiAccountId = data.id;
        status = "connected";
      }
    } catch {
      status = "error";
    }
  }

  const [account] = await db
    .insert(masterAccountsTable)
    .values({
      userId: req.userId!,
      metaapiAccountId,
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
    mt5Login: account.mt5Login,
    broker: account.broker,
    server: account.server,
    status: account.status,
    createdAt: account.createdAt,
  });
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

  res.json({
    id: account.id,
    userId: account.userId,
    metaapiAccountId: account.metaapiAccountId,
    mt5Login: account.mt5Login,
    broker: account.broker,
    server: account.server,
    status: account.status,
    createdAt: account.createdAt,
  });
});

router.delete("/master-accounts/:id", authenticate, async (req, res): Promise<void> => {
  const params = DeleteMasterAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db
    .delete(masterAccountsTable)
    .where(and(eq(masterAccountsTable.id, params.data.id), eq(masterAccountsTable.userId, req.userId!)));

  res.sendStatus(204);
});

export default router;
