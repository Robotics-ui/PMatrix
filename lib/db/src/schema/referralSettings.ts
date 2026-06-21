import { pgTable, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const referralSettingsTable = pgTable("referral_settings", {
  id: serial("id").primaryKey(),
  referralsRequired: integer("referrals_required").notNull(),
  rewardDays: integer("reward_days").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReferralSettingsSchema = createInsertSchema(referralSettingsTable).omit({ id: true, createdAt: true });
export type InsertReferralSettings = z.infer<typeof insertReferralSettingsSchema>;
export type ReferralSettings = typeof referralSettingsTable.$inferSelect;
