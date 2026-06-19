import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const slaveAccountsTable = pgTable("slave_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  metaapiAccountId: text("metaapi_account_id"),
  subscriberId: text("subscriber_id"),
  mt5Login: text("mt5_login").notNull(),
  broker: text("broker").notNull(),
  server: text("server").notNull(),
  investorPasswordEncrypted: text("investor_password_encrypted").notNull(),
  status: text("status").notNull().default("connecting"),
  deploymentStatus: text("deployment_status"),
  connectionStatus: text("connection_status"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("slave_accounts_user_id_idx").on(table.userId),
  index("slave_accounts_status_idx").on(table.status),
  index("slave_accounts_metaapi_account_id_idx").on(table.metaapiAccountId),
  index("slave_accounts_subscriber_id_idx").on(table.subscriberId),
]);

export const insertSlaveAccountSchema = createInsertSchema(slaveAccountsTable).omit({ id: true, createdAt: true });
export type InsertSlaveAccount = z.infer<typeof insertSlaveAccountSchema>;
export type SlaveAccount = typeof slaveAccountsTable.$inferSelect;
