import { pgTable, text, serial, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  status: text("status").notNull().default("active"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  otpCode: text("otp_code"),
  otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }),
  deviceFingerprint: text("device_fingerprint"),
  theme: text("theme").notNull().default("dark"),
}, (table) => [
  index("users_email_idx").on(table.email),
  index("users_role_idx").on(table.role),
  index("users_status_idx").on(table.status),
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
