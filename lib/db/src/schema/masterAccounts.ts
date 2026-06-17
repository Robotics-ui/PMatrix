import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const masterAccountsTable = pgTable("master_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  metaapiAccountId: text("metaapi_account_id"),
  mt5Login: text("mt5_login").notNull(),
  broker: text("broker").notNull(),
  server: text("server").notNull(),
  investorPasswordEncrypted: text("investor_password_encrypted").notNull(),
  status: text("status").notNull().default("connecting"),
  deploymentStatus: text("deployment_status"),
  connectionStatus: text("connection_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMasterAccountSchema = createInsertSchema(masterAccountsTable).omit({ id: true, createdAt: true });
export type InsertMasterAccount = z.infer<typeof insertMasterAccountSchema>;
export type MasterAccount = typeof masterAccountsTable.$inferSelect;
