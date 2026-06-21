import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const SMS_EVENT_TYPES = [
  "subscription_activated",
  "subscription_expiring",
  "subscription_expired",
  "payment_received",
  "master_account_approved",
  "account_suspended",
  "announcement",
  "broadcast",
  "free_trial_activated",
  "free_trial_expired",
  "referral_reward",
] as const;

export type SmsEventType = (typeof SMS_EVENT_TYPES)[number];

export const smsTemplatesTable = pgTable("sms_templates", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull().unique(),
  template: text("template").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSmsTemplateSchema = createInsertSchema(smsTemplatesTable).omit({ id: true });
export type InsertSmsTemplate = z.infer<typeof insertSmsTemplateSchema>;
export type SmsTemplate = typeof smsTemplatesTable.$inferSelect;
