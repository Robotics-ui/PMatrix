import { Router } from "express";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  usersTable,
  subscriptionsTable,
  passwordResetTokensTable,
  promoCodesTable,
  referralsTable,
} from "@workspace/db";
import { RegisterBody, LoginBody, ForgotPasswordBody } from "@workspace/api-zod";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";
import { authenticate } from "../middlewares/authenticate";
import { generateUniquePromoCode } from "../lib/promoCode";
import { createNotification } from "../lib/notificationService";
import { logger } from "../lib/logger";

const router = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, email, phone, password } = parsed.data;
  const referralCode = typeof req.body.referralCode === "string"
    ? req.body.referralCode.trim().toUpperCase()
    : null;

  // Email uniqueness (enforced by DB unique constraint, but give a clear error)
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing.length > 0) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }

  // Phone abuse prevention: detect if same phone was already used for a free trial
  const usersWithPhone = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, phone));

  let phoneHadTrial = false;
  for (const u of usersWithPhone) {
    const [existingSub] = await db
      .select()
      .from(subscriptionsTable)
      .where(
        eq(subscriptionsTable.userId, u.id),
      )
      .limit(1);
    if (existingSub && existingSub.freeTrialUsed === 1) {
      phoneHadTrial = true;
      break;
    }
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(usersTable)
    .values({ name, email, phone, passwordHash })
    .returning();

  // ── Generate unique referral promo code for new user ──────────────────────
  let myPromoCode: string | null = null;
  try {
    myPromoCode = await generateUniquePromoCode(user.id);
  } catch (err) {
    logger.error({ err, userId: user.id }, "Failed to generate promo code");
  }

  // ── Grant free trial or expired subscription ──────────────────────────────
  const now = new Date();
  if (phoneHadTrial) {
    // Phone was already used for a free trial — no second trial
    await db.insert(subscriptionsTable).values({
      userId: user.id,
      status: "expired",
      daysPaid: 0,
      freeTrialUsed: 0,
    });
    logger.info(
      { userId: user.id, phone },
      "Registration: phone already used for free trial — starting with expired subscription",
    );
  } else {
    // Grant 2-day free trial
    const trialEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    await db.insert(subscriptionsTable).values({
      userId: user.id,
      status: "free_trial",
      startDate: now,
      endDate: trialEnd,
      daysPaid: 0,
      freeTrialUsed: 1,
    });

    await createNotification({
      userId: user.id,
      type: "free_trial_activated",
      title: "Welcome — Free Trial Active",
      message:
        "Your 2-day free trial is now active. Add a slave account and bind it to a strategy to start receiving copy trades.",
    });

    logger.info(
      { userId: user.id, trialEnd },
      "Registration: 2-day free trial granted",
    );
  }

  // ── Process inbound referral code ─────────────────────────────────────────
  if (referralCode) {
    try {
      const [promoCodeRecord] = await db
        .select()
        .from(promoCodesTable)
        .where(eq(promoCodesTable.code, referralCode))
        .limit(1);

      if (!promoCodeRecord) {
        logger.info(
          { userId: user.id, referralCode },
          "Referral code not found — skipping",
        );
      } else if (promoCodeRecord.userId === user.id) {
        logger.warn(
          { userId: user.id, referralCode },
          "Self-referral attempt — rejected",
        );
      } else {
        // Check referrer is not the same person (email or phone match)
        const [referrer] = await db
          .select()
          .from(usersTable)
          .where(eq(usersTable.id, promoCodeRecord.userId))
          .limit(1);

        const isSelfReferral =
          referrer && (referrer.email === email || referrer.phone === phone);

        if (isSelfReferral) {
          logger.warn(
            { userId: user.id, referrerId: promoCodeRecord.userId },
            "Self-referral via matching email/phone — rejected",
          );
        } else {
          // Check for duplicate referral (same referredUserId)
          const [existingReferral] = await db
            .select()
            .from(referralsTable)
            .where(eq(referralsTable.referredUserId, user.id))
            .limit(1);

          if (!existingReferral) {
            await db.insert(referralsTable).values({
              referrerId: promoCodeRecord.userId,
              referredUserId: user.id,
              referredPhone: phone,
              referredEmail: email,
              status: "pending",
            });
            logger.info(
              {
                referrerId: promoCodeRecord.userId,
                referredUserId: user.id,
                referralCode,
              },
              "Referral recorded",
            );
          }
        }
      }
    } catch (err) {
      logger.error({ err, userId: user.id, referralCode }, "Failed to process referral code");
    }
  }

  const token = signToken(user.id, user.role);
  res.status(201).json({
    token,
    mustChangePassword: user.mustChangePassword,
    promoCode: myPromoCode,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    },
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (user.status === "suspended") {
    res.status(403).json({ error: "Your account has been suspended" });
    return;
  }

  const token = signToken(user.id, user.role);
  res.json({
    token,
    mustChangePassword: user.mustChangePassword,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    },
  });
});

router.post("/auth/logout", authenticate, async (_req, res): Promise<void> => {
  res.json({ message: "Logged out successfully" });
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  if (!user) {
    res.json({ message: "If an account exists with that email, a reset link has been sent." });
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(passwordResetTokensTable).values({ userId: user.id, token, expiresAt });

  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost:5000";
  const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "http";
  const baseUrl = process.env.APP_URL ?? `${proto}://${host}`;
  const resetLink = `${baseUrl}/reset-password?token=${token}`;

  res.json({
    message: "Reset link generated. Share this link with the user — it expires in 1 hour.",
    resetLink,
  });
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };

  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "Token is required" });
    return;
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const [resetToken] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.token, token));

  if (!resetToken) {
    res.status(400).json({ error: "Invalid or expired reset link" });
    return;
  }
  if (resetToken.used) {
    res.status(400).json({ error: "This reset link has already been used" });
    return;
  }
  if (new Date() > resetToken.expiresAt) {
    res.status(400).json({ error: "This reset link has expired. Please request a new one." });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(usersTable)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(usersTable.id, resetToken.userId));
  await db
    .update(passwordResetTokensTable)
    .set({ used: true })
    .where(eq(passwordResetTokensTable.id, resetToken.id));

  res.json({ message: "Password reset successfully. You can now log in with your new password." });
});

router.patch("/auth/change-password", authenticate, async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || typeof currentPassword !== "string") {
    res.status(400).json({ error: "Current password is required" });
    return;
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const userId = req.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  if (currentPassword === newPassword) {
    res.status(400).json({
      error: "New password must be different from the current password",
    });
    return;
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(usersTable)
    .set({ passwordHash, mustChangePassword: false })
    .where(eq(usersTable.id, userId));

  res.json({ message: "Password changed successfully" });
});

export default router;
