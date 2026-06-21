import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const promoCodesTable = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  code: text("code").notNull().unique(),
  totalReferrals: integer("total_referrals").notNull().default(0),
  totalRewardDays: integer("total_reward_days").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("promo_codes_user_id_uidx").on(table.userId),
  uniqueIndex("promo_codes_code_uidx").on(table.code),
]);

export type PromoCode = typeof promoCodesTable.$inferSelect;
