import { pgTable, serial, boolean, text, integer, timestamp } from "drizzle-orm/pg-core";

export const bannerSettingsTable = pgTable("banner_settings", {
  id: serial("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  displayMode: text("display_mode").notNull().default("ticker"),
  backgroundColor: text("background_color").notNull().default("#0a0f1e"),
  primaryColor: text("primary_color").notNull().default("#2563eb"),
  secondaryColor: text("secondary_color").notNull().default("#16a34a"),
  textColor: text("text_color").notNull().default("#f1f5f9"),
  bullishColor: text("bullish_color").notNull().default("#16a34a"),
  bearishColor: text("bearish_color").notNull().default("#dc2626"),
  fontFamily: text("font_family").notNull().default("Inter"),
  fontSize: integer("font_size").notNull().default(13),
  bannerHeight: integer("banner_height").notNull().default(48),
  tickerSpeed: integer("ticker_speed").notNull().default(40),
  refreshRate: integer("refresh_rate").notNull().default(10),
  selectedPairs: text("selected_pairs").notNull().default('["EUR/USD","GBP/USD","USD/JPY","USD/CHF","AUD/USD","NZD/USD","USD/CAD","EUR/GBP","EUR/JPY","GBP/JPY"]'),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
