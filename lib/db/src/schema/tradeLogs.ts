import { pgTable, serial, integer, text, timestamp, index, numeric, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradeLogsTable = pgTable("trade_logs", {
  id: serial("id").primaryKey(),
  strategyId: integer("strategy_id").notNull(),
  slaveAccountId: integer("slave_account_id"),
  action: text("action").notNull(),
  symbol: text("symbol"),
  side: text("side"),
  volume: numeric("volume"),
  profit: numeric("profit"),
  openPrice: numeric("open_price"),
  closePrice: numeric("close_price"),
  transactionId: text("transaction_id"),
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("trade_logs_strategy_id_idx").on(table.strategyId),
  index("trade_logs_slave_account_id_idx").on(table.slaveAccountId),
  index("trade_logs_created_at_idx").on(table.createdAt),
  uniqueIndex("trade_logs_transaction_id_uidx").on(table.transactionId),
]);

export const insertTradeLogSchema = createInsertSchema(tradeLogsTable).omit({ id: true, createdAt: true });
export type InsertTradeLog = z.infer<typeof insertTradeLogSchema>;
export type TradeLog = typeof tradeLogsTable.$inferSelect;
