import { db, smsSettingsTable, smsTemplatesTable, smsQueueTable, smsLogsTable, notificationPreferencesTable, subscriptionsTable, usersTable } from "@workspace/db";
import type { SmsEventType } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { logger } from "./logger";

let settingsCache: { data: typeof smsSettingsTable.$inferSelect; cachedAt: number } | null = null;
const SETTINGS_TTL_MS = 60_000;

async function getSettings() {
  const now = Date.now();
  if (settingsCache && now - settingsCache.cachedAt < SETTINGS_TTL_MS) {
    return settingsCache.data;
  }
  const [settings] = await db.select().from(smsSettingsTable).limit(1);
  if (settings) {
    settingsCache = { data: settings, cachedAt: now };
  }
  return settings ?? null;
}

export function invalidateSmsSettingsCache() {
  settingsCache = null;
}

async function getTemplate(eventType: SmsEventType): Promise<string | null> {
  const [tpl] = await db
    .select()
    .from(smsTemplatesTable)
    .where(and(eq(smsTemplatesTable.eventType, eventType), eq(smsTemplatesTable.enabled, true)))
    .limit(1);
  return tpl?.template ?? null;
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? "");
}

export async function enqueueSms(opts: {
  userId?: number;
  phone: string;
  message: string;
  eventType: SmsEventType;
  scheduledFor?: Date;
}) {
  await db.insert(smsQueueTable).values({
    userId: opts.userId ?? null,
    phone: opts.phone,
    message: opts.message,
    eventType: opts.eventType,
    status: "pending",
    attempts: 0,
    scheduledFor: opts.scheduledFor ?? new Date(),
  });
}

export async function enqueueEventSms(opts: {
  userId: number;
  phone: string;
  eventType: SmsEventType;
  vars?: Record<string, string>;
  preferenceKey?: "subscriptionAlerts" | "tradeAlerts" | "announcements";
}) {
  const { userId, phone, eventType, vars = {}, preferenceKey } = opts;

  if (preferenceKey) {
    const [pref] = await db
      .select()
      .from(notificationPreferencesTable)
      .where(eq(notificationPreferencesTable.userId, userId))
      .limit(1);
    if (pref && pref[preferenceKey] === false) return;
  }

  const template = await getTemplate(eventType);
  if (!template) {
    logger.warn({ eventType }, "SMS template not found or disabled — skipping");
    return;
  }

  const message = renderTemplate(template, vars);
  await enqueueSms({ userId, phone, message, eventType });
}

function resolveCreds(settings: typeof smsSettingsTable.$inferSelect) {
  return {
    apiKey: process.env.MSPACE_API_KEY?.trim() || settings.apiKey,
    username: process.env.MSPACE_USERNAME?.trim() || settings.username,
    senderId: process.env.MSPACE_SENDER_ID?.trim() || settings.senderId,
    apiUrl: settings.apiUrl || "https://api.mspace.co.ke/sms/v1/send",
  };
}

export async function sendSmsNow(phone: string, message: string): Promise<{ success: boolean; response: string }> {
  const settings = await getSettings();
  if (!settings || !settings.enabled) {
    return { success: false, response: "SMS not enabled" };
  }

  const { apiKey, username, senderId, apiUrl } = resolveCreds(settings);

  if (!apiKey || !username) {
    return { success: false, response: "MSpace API Key and Username are required" };
  }

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        username,
        mobile: phone,
        message,
        from: senderId,
      }),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    const responseStr = typeof parsed === "object" && parsed !== null
      ? JSON.stringify(parsed)
      : text.slice(0, 500);

    return { success: res.ok, response: responseStr };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, response: msg };
  }
}

export async function validateMSpaceCredentials(opts: {
  apiUrl: string;
  apiKey: string;
  username: string;
  senderId: string;
  testPhone: string;
}): Promise<{ valid: boolean; response: string; statusCode?: number }> {
  const { apiUrl, apiKey, username, senderId, testPhone } = opts;

  if (!apiKey || !username || !senderId) {
    return { valid: false, response: "API Key, Username and Sender ID are required" };
  }

  try {
    const res = await fetch(apiUrl || "https://api.mspace.co.ke/sms/v1/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        username,
        mobile: testPhone,
        message: "PESAMATRIX: Credential validation test.",
        from: senderId,
      }),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    const responseStr = typeof parsed === "object" && parsed !== null
      ? JSON.stringify(parsed)
      : text.slice(0, 500);

    return { valid: res.ok, response: responseStr, statusCode: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, response: msg };
  }
}

export async function processSmsQueue(batchSize = 50, concurrency = 10): Promise<void> {
  const settings = await getSettings();
  if (!settings || !settings.enabled) return;

  const now = new Date();
  const pending = await db
    .select()
    .from(smsQueueTable)
    .where(
      and(
        eq(smsQueueTable.status, "pending"),
      ),
    )
    .limit(batchSize);

  if (pending.length === 0) return;

  const toProcess = pending.filter((item) => new Date(item.scheduledFor) <= now && item.attempts < 3);

  if (toProcess.length === 0) return;

  for (let i = 0; i < toProcess.length; i += concurrency) {
    const chunk = toProcess.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (item) => {
        await db.update(smsQueueTable).set({ status: "processing", lastAttemptAt: new Date() }).where(eq(smsQueueTable.id, item.id));

        const { success, response } = await sendSmsNow(item.phone, item.message);

        const newStatus = success ? "sent" : item.attempts + 1 >= 3 ? "failed" : "pending";
        await db.update(smsQueueTable)
          .set({ status: newStatus, attempts: item.attempts + 1, lastAttemptAt: new Date() })
          .where(eq(smsQueueTable.id, item.id));

        await db.insert(smsLogsTable).values({
          queueId: item.id,
          userId: item.userId,
          phone: item.phone,
          message: item.message,
          eventType: item.eventType,
          status: success ? "sent" : "failed",
          providerResponse: response,
          deliveryStatus: success ? "delivered" : "failed",
          sentAt: success ? new Date() : null,
        });
      }),
    );
  }
}

export async function broadcastSms(opts: {
  message: string;
  eventType?: SmsEventType;
  onlyActive?: boolean;
}): Promise<{ queued: number }> {
  const { message, eventType = "broadcast", onlyActive = true } = opts;

  let userIds: number[] = [];

  if (onlyActive) {
    const activeSubs = await db
      .select({ userId: subscriptionsTable.userId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.status, "active"));
    userIds = activeSubs.map((s) => s.userId);
  } else {
    const allUsers = await db.select({ id: usersTable.id }).from(usersTable);
    userIds = allUsers.map((u) => u.id);
  }

  if (userIds.length === 0) return { queued: 0 };

  const users = await db
    .select({ id: usersTable.id, phone: usersTable.phone })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));

  const withPhone = users.filter((u) => u.phone && u.phone.trim().length > 0);

  if (withPhone.length === 0) return { queued: 0 };

  await db.insert(smsQueueTable).values(
    withPhone.map((u) => ({
      userId: u.id,
      phone: u.phone!,
      message,
      eventType,
      status: "pending",
      attempts: 0,
      scheduledFor: new Date(),
    })),
  );

  return { queued: withPhone.length };
}

export async function seedDefaultTemplates() {
  const defaults: { eventType: SmsEventType; template: string }[] = [
    {
      eventType: "subscription_activated",
      template: "Hi {{name}}, your PESAMATRIX subscription is now active until {{endDate}}. Happy copy trading!",
    },
    {
      eventType: "subscription_expiring",
      template: "Hi {{name}}, your PESAMATRIX subscription expires in {{daysLeft}} day(s) on {{endDate}}. Renew now to keep copy trading.",
    },
    {
      eventType: "subscription_expired",
      template: "Hi {{name}}, your PESAMATRIX subscription has expired. Subscribe again to resume copy trading.",
    },
    {
      eventType: "payment_received",
      template: "Hi {{name}}, payment of KES {{amount}} received (Ref: {{receipt}}). Your subscription is now active.",
    },
    {
      eventType: "master_account_approved",
      template: "Hi {{name}}, your master account {{accountId}} has been approved and is now live on PESAMATRIX.",
    },
    {
      eventType: "account_suspended",
      template: "Hi {{name}}, your PESAMATRIX account has been suspended. Contact support for assistance.",
    },
    {
      eventType: "announcement",
      template: "PESAMATRIX: {{message}}",
    },
    {
      eventType: "broadcast",
      template: "{{message}}",
    },
  ];

  for (const d of defaults) {
    const [existing] = await db.select().from(smsTemplatesTable).where(eq(smsTemplatesTable.eventType, d.eventType)).limit(1);
    if (!existing) {
      await db.insert(smsTemplatesTable).values({ eventType: d.eventType, template: d.template, enabled: true });
    }
  }
}
