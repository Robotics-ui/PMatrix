import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, paymentsTable, subscriptionsTable, adminSettingsTable, bindingsTable, slaveAccountsTable } from "@workspace/db";
import { InitiatePaymentBody } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate";
import { logger } from "../lib/logger";
import { syncSlaveSubscriberToCopyFactory } from "../lib/metaapi";

const router = Router();

async function getDailyFee(): Promise<number> {
  const [settings] = await db.select().from(adminSettingsTable).orderBy(adminSettingsTable.id).limit(1);
  return settings ? parseFloat(settings.dailyFee as string) : 100;
}

function addTradingDays(start: Date, days: number): Date {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

router.get("/payments", authenticate, async (req, res): Promise<void> => {
  const payments = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.userId, req.userId!))
    .orderBy(desc(paymentsTable.createdAt));

  res.json(
    payments.map((p) => ({
      ...p,
      amount: parseFloat(p.amount as string),
    }))
  );
});

router.post("/payments", authenticate, async (req, res): Promise<void> => {
  const parsed = InitiatePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { phone, days } = parsed.data;
  const dailyFee = await getDailyFee();
  const amount = days * dailyFee;

  // Normalize phone to 254XXXXXXXXX format
  // Handles: +254XXXXXXXXX, 0XXXXXXXXX, 7XXXXXXXXX, 254XXXXXXXXX
  let normalizedPhone = phone.replace(/\s+/g, "").replace(/^\+/, "");
  if (normalizedPhone.startsWith("0")) {
    normalizedPhone = "254" + normalizedPhone.slice(1);
  } else if (/^[71]/.test(normalizedPhone) && normalizedPhone.length === 9) {
    normalizedPhone = "254" + normalizedPhone;
  }

  // Check if MPESA credentials are configured
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const passkey = process.env.MPESA_PASSKEY;
  const shortcode = process.env.MPESA_SHORTCODE;
  const callbackUrl = process.env.MPESA_CALLBACK_URL;

  // Log callback URL at runtime so it can be verified in logs
  logger.info(
    {
      MPESA_CALLBACK_URL: callbackUrl ?? "NOT_SET",
    },
    "MPESA env check"
  );

  if (!consumerKey || !consumerSecret || !passkey || !shortcode || !callbackUrl) {
    // Demo mode: simulate payment completion
    logger.warn(
      {
        missingVars: {
          consumerKey: !consumerKey,
          consumerSecret: !consumerSecret,
          passkey: !passkey,
          shortcode: !shortcode,
          callbackUrl: !callbackUrl,
        },
      },
      "MPESA credentials not configured, using demo mode"
    );

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        userId: req.userId!,
        phone: normalizedPhone,
        amount: amount.toFixed(2),
        status: "completed",
        days,
        mpesaReceipt: `DEMO${Date.now()}`,
        checkoutRequestId: `DEMO-${Date.now()}`,
      })
      .returning();

    // Activate subscription
    await activateSubscription(req.userId!, days);

    res.json({
      checkoutRequestId: payment.checkoutRequestId!,
      message: "Demo mode: Payment simulated and subscription activated",
      amount,
    });
    return;
  }

  try {
    // STEP 1: Get M-Pesa access token + log OAuth response
    const authResponse = await fetch(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`,
        },
      }
    );
    const authData = (await authResponse.json()) as { access_token?: string; error?: string; error_description?: string };
    logger.info(
      {
        oauthHttpStatus: authResponse.status,
        hasAccessToken: !!authData.access_token,
        oauthError: authData.error ?? null,
        oauthErrorDescription: authData.error_description ?? null,
      },
      "MPESA OAuth response"
    );
    const accessToken = authData.access_token;
    if (!accessToken) {
      logger.error({ authData, httpStatus: authResponse.status }, "MPESA OAuth token fetch failed");
      res.status(500).json({ error: "Failed to obtain M-Pesa access token" });
      return;
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, "")
      .slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

    // STEP 2: Log full STK request payload BEFORE sending
    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: Math.ceil(amount),
      PartyA: normalizedPhone,
      PartyB: shortcode,
      PhoneNumber: normalizedPhone,
      CallBackURL: callbackUrl ?? "NOT_SET",
      AccountReference: "PESAMATRIX",
      TransactionDesc: `${days} trading day(s) subscription`,
    };
    logger.info(
      {
        BusinessShortCode: stkPayload.BusinessShortCode,
        Timestamp: stkPayload.Timestamp,
        Amount: stkPayload.Amount,
        PhoneNumber: stkPayload.PhoneNumber,
        CallBackURL: stkPayload.CallBackURL,
        callbackUrlSet: !!callbackUrl,
      },
      "STK Push request payload"
    );

    const stkResponse = await fetch("https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(stkPayload),
    });

    const stkData = (await stkResponse.json()) as {
      CheckoutRequestID?: string;
      ResponseCode?: string;
      ResponseDescription?: string;
      errorCode?: string;
      errorMessage?: string;
      requestId?: string;
    };

    // STEP 3: Log full STK response
    if (!stkData.CheckoutRequestID) {
      logger.error(
        {
          stkData,
          httpStatus: stkResponse.status,
        },
        "FULL STK FAILURE RESPONSE"
      );
      logger.error(
        {
          errorCode: stkData.errorCode,
          errorMessage: stkData.errorMessage,
          responseCode: stkData.ResponseCode,
          responseDescription: stkData.ResponseDescription,
          callbackUrlDomain: callbackUrl ? new URL(callbackUrl).hostname : "NOT_SET",
          httpStatus: stkResponse.status,
        },
        "STK Push rejected by Safaricom"
      );
      const detail = stkData.errorMessage ?? stkData.ResponseDescription ?? "STK Push failed";
      res.status(400).json({ error: detail, code: stkData.errorCode ?? stkData.ResponseCode });
      return;
    }

    logger.info(
      {
        CheckoutRequestID: stkData.CheckoutRequestID,
        ResponseCode: stkData.ResponseCode,
        ResponseDescription: stkData.ResponseDescription,
      },
      "STK Push accepted by Safaricom"
    );

    const [payment] = await db
      .insert(paymentsTable)
      .values({
        userId: req.userId!,
        phone: normalizedPhone,
        amount: amount.toFixed(2),
        status: "pending",
        days,
        checkoutRequestId: stkData.CheckoutRequestID,
      })
      .returning();

    res.json({
      checkoutRequestId: payment.checkoutRequestId!,
      message: "STK Push sent to your phone. Complete the payment to activate subscription.",
      amount,
    });
  } catch (err) {
    req.log.error({ err }, "STK Push error");
    res.status(500).json({ error: "Payment initiation failed" });
  }
});

router.get("/payments/callback", (_req, res): void => {
  res.redirect("/");
});

router.post("/payments/callback", async (req, res): Promise<void> => {
  // Step 5: Log incoming Safaricom callback immediately
  logger.info({ rawBody: req.body }, "MPESA callback received");
  try {
    const body = req.body?.Body?.stkCallback;
    if (!body) {
      logger.warn({ rawBody: req.body }, "MPESA callback missing Body.stkCallback");
      res.json({ message: "OK" });
      return;
    }
    logger.info(
      {
        CheckoutRequestID: body.CheckoutRequestID,
        ResultCode: body.ResultCode,
        ResultDesc: body.ResultDesc,
      },
      "MPESA callback stkCallback"
    );

    const { CheckoutRequestID, ResultCode, CallbackMetadata } = body;

    const [payment] = await db
      .select()
      .from(paymentsTable)
      .where(eq(paymentsTable.checkoutRequestId, CheckoutRequestID));

    if (!payment) {
      res.json({ message: "OK" });
      return;
    }

    if (ResultCode === 0) {
      // Success
      const receiptItem = CallbackMetadata?.Item?.find((i: { Name: string }) => i.Name === "MpesaReceiptNumber");
      const mpesaReceipt = receiptItem?.Value as string | undefined;

      await db
        .update(paymentsTable)
        .set({ status: "completed", mpesaReceipt })
        .where(eq(paymentsTable.id, payment.id));

      await activateSubscription(payment.userId, payment.days);
    } else {
      await db.update(paymentsTable).set({ status: "failed" }).where(eq(paymentsTable.id, payment.id));
    }

    res.json({ message: "OK" });
  } catch (err) {
    logger.error({ err }, "M-Pesa callback error");
    res.json({ message: "OK" });
  }
});

router.get("/payments/:checkoutRequestId/status", authenticate, async (req, res): Promise<void> => {
  const { checkoutRequestId } = req.params;

  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.checkoutRequestId, checkoutRequestId as string));

  if (!payment || payment.userId !== req.userId!) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  res.json({
    status: payment.status,
    mpesaReceipt: payment.mpesaReceipt ?? null,
    amount: parseFloat(payment.amount as string),
  });
});

router.post("/payments/:checkoutRequestId/verify", authenticate, async (req, res): Promise<void> => {
  const { checkoutRequestId } = req.params;

  const [payment] = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.checkoutRequestId, checkoutRequestId as string));

  if (!payment || payment.userId !== req.userId!) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }

  if (payment.status !== "pending") {
    res.json({ status: payment.status, mpesaReceipt: payment.mpesaReceipt ?? null, amount: parseFloat(payment.amount as string) });
    return;
  }

  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const passkey = process.env.MPESA_PASSKEY;
  const shortcode = process.env.MPESA_SHORTCODE;

  if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
    res.json({ status: payment.status, mpesaReceipt: null, amount: parseFloat(payment.amount as string) });
    return;
  }

  try {
    const authResponse = await fetch(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}`,
        },
      }
    );
    const authData = (await authResponse.json()) as { access_token?: string };
    if (!authData.access_token) {
      res.json({ status: payment.status, mpesaReceipt: null, amount: parseFloat(payment.amount as string) });
      return;
    }

    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
    const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");

    const queryResponse = await fetch("https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    });

    const queryData = (await queryResponse.json()) as {
      ResultCode?: string | number;
      ResultDesc?: string;
      errorCode?: string;
    };

    logger.info({ checkoutRequestId, queryData }, "STK Query response");

    const resultCode = queryData.ResultCode !== undefined ? Number(queryData.ResultCode) : null;

    if (resultCode === 0) {
      await db.update(paymentsTable).set({ status: "completed" }).where(eq(paymentsTable.id, payment.id));
      await activateSubscription(payment.userId, payment.days);
      res.json({ status: "completed", mpesaReceipt: null, amount: parseFloat(payment.amount as string) });
    } else if (resultCode !== null && resultCode !== 0) {
      await db.update(paymentsTable).set({ status: "failed" }).where(eq(paymentsTable.id, payment.id));
      res.json({ status: "failed", mpesaReceipt: null, amount: parseFloat(payment.amount as string) });
    } else {
      res.json({ status: "pending", mpesaReceipt: null, amount: parseFloat(payment.amount as string) });
    }
  } catch (err) {
    logger.error({ err }, "STK Query error");
    res.json({ status: payment.status, mpesaReceipt: null, amount: parseFloat(payment.amount as string) });
  }
});

async function activateSubscription(userId: number, days: number): Promise<void> {
  const [existing] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.userId, userId));

  const now = new Date();

  function addTradingDaysLocal(start: Date, d: number): Date {
    return addTradingDays(start, d);
  }

  if (!existing) {
    const endDate = addTradingDaysLocal(now, days);
    await db.insert(subscriptionsTable).values({
      userId,
      status: "active",
      startDate: now,
      endDate,
      daysPaid: days,
    });
  } else {
    // Extend from current end date if still active, otherwise from now
    const baseDate = existing.status === "active" && existing.endDate && existing.endDate > now
      ? existing.endDate
      : now;
    const newEndDate = addTradingDaysLocal(baseDate, days);

    await db
      .update(subscriptionsTable)
      .set({
        status: "active",
        startDate: existing.startDate ?? now,
        endDate: newEndDate,
        daysPaid: existing.daysPaid + days,
      })
      .where(eq(subscriptionsTable.userId, userId));

    // Reactivate suspended bindings and sync to CopyFactory
    const userSlaveAccounts = await db
      .select()
      .from(slaveAccountsTable)
      .where(eq(slaveAccountsTable.userId, userId));

    for (const slave of userSlaveAccounts) {
      await db
        .update(bindingsTable)
        .set({ status: "active" })
        .where(eq(bindingsTable.slaveAccountId, slave.id));

      // Push restored subscriptions to CopyFactory
      await syncSlaveSubscriberToCopyFactory(slave.id);
    }
  }
}

export default router;
