import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  status: text("status").notNull().default("expired"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  daysPaid: integer("days_paid").notNull().default(0),
  expiryWarningSentAt: timestamp("expiry_warning_sent_at", { withTimezone: true }),
  expiryWarning1DSentAt: timestamp("expiry_warning_1d_sent_at", { withTimezone: true }),
  expiryWarning0DSentAt: timestamp("expiry_warning_0d_sent_at", { withTimezone: true }),
  freeTrialUsed: integer("free_trial_used").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("subscriptions_user_id_idx").on(table.userId),
  index("subscriptions_status_idx").on(table.status),
  index("subscriptions_end_date_idx").on(table.endDate),
  // Composite index for the scheduler enforcement tick:
  // filters by (status, endDate) and joins back by userId — covers both
  // the expiry scan and the expiry-warning scan in a single index pass.
  index("subscriptions_status_end_date_idx").on(table.status, table.endDate),
  index("subscriptions_user_status_idx").on(table.userId, table.status),
]);

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
