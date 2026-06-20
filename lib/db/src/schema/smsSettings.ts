import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const smsSettingsTable = pgTable("sms_settings", {
  id: serial("id").primaryKey(),
  providerName: text("provider_name").notNull().default("MSpace"),
  apiUrl: text("api_url").notNull().default("https://api.mspace.co.ke/sms/v1/send"),
  apiKey: text("api_key").notNull().default(""),
  username: text("username").notNull().default(""),
  senderId: text("sender_id").notNull().default("PESAMTRX"),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSmsSettingsSchema = createInsertSchema(smsSettingsTable).omit({ id: true });
export type InsertSmsSettings = z.infer<typeof insertSmsSettingsSchema>;
export type SmsSettings = typeof smsSettingsTable.$inferSelect;
