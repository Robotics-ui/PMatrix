import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const referralsTable = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: integer("referrer_id").notNull(),
  referredUserId: integer("referred_user_id").notNull().unique(),
  referredPhone: text("referred_phone").notNull(),
  referredEmail: text("referred_email").notNull(),
  status: text("status").notNull().default("pending"),
  rewardDays: integer("reward_days"),
  rewardedAt: timestamp("rewarded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("referrals_referrer_id_idx").on(table.referrerId),
  uniqueIndex("referrals_referred_user_id_uidx").on(table.referredUserId),
  index("referrals_status_idx").on(table.status),
]);

export type Referral = typeof referralsTable.$inferSelect;
