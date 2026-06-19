import { pgTable, serial, integer, numeric, timestamp, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adminSettingsTable = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  dailyFee: numeric("daily_fee", { precision: 10, scale: 2 }).notNull().default("100"),
  minDays: integer("min_days").notNull().default(1),
  maxDays: integer("max_days").notNull().default(365),
  metaApiToken: text("meta_api_token"),
  expiryWarningDays: integer("expiry_warning_days").notNull().default(3),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAdminSettingsSchema = createInsertSchema(adminSettingsTable).omit({ id: true });
export type InsertAdminSettings = z.infer<typeof insertAdminSettingsSchema>;
export type AdminSettings = typeof adminSettingsTable.$inferSelect;
