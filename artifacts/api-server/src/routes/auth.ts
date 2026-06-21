import { Router } from "express";
import { eq, and, ne } from "drizzle-orm";
import crypto from "crypto";
import {
  db,
  usersTable,
  subscriptionsTable,
  passwordResetTokensTable,
  promoCodesTable,
  referralsTable,
  smsQueueTable,
} from "@workspace/db";
import { RegisterBody, LoginBody, ForgotPasswordBody } from "@workspace/api-zod";
import { hashPassword, verifyPassword, signToken } from "../lib/auth";
import { authenticate } from "../middlewares/authenticate";
import { generateUniquePromoCode } from "../lib/promoCode";
import { createNotification } from "../lib/notificationService";
import { logger } from "../lib/logger";

const router = Router();

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function queueOtpSms(userId: number, phone: string, otp: string): Promise<void> {
  const message = `Your PESAMATRIX verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
  try {
    await db.insert(smsQueueTable).values({
      userId,
      phone,
      message,
      eventType: "otp_verification",
      status: "pending",
    });
  } catch (err) {
    logger.error({ err, userId }, "Failed to queue OTP SMS");
  }
}

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
  const deviceFingerprint = typeof req.body.deviceFingerprint === "string"
    ? req.body.deviceFingerprint.trim()
    : null;

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing.length > 0) {
    res.status(400).json({ error: "Email already registered" });
    return;
  }

  // Check if phone is already registered (uniqueness)
  const usersWithPhone = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, phone));

  if (usersWithPhone.length > 0) {
    res.status(400).json({ error: "Phone number already registered" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(usersTable)
    .values({ name, email, phone, passwordHash, deviceFingerprint: deviceFingerprint ?? null })
    .returning();

  let myPromoCode: string | null = null;
  try {
    myPromoCode = await generateUniquePromoCode(user.id);
  } catch (err) {
    logger.error({ err, userId: user.id }, "Failed to generate promo code");
  }

  // Create expired subscription — trial only activates after OTP verification
  await db.insert(subscriptionsTable).values({
    userId: user.id,
    status: "expired",
    daysPaid: 0,
    freeTrialUsed: 0,
  });

  // Generate and send OTP
  const otp = generateOtp();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db
    .update(usersTable)
    .set({ otpCode: otp, otpExpiresAt })
    .where(eq(usersTable.id, user.id));
  await queueOtpSms(user.id, phone, otp);

  logger.info({ userId: user.id }, "Registration: OTP sent, awaiting phone verification");

  // Process inbound referral code
  if (referralCode) {
    try {
      const [promoCodeRecord] = await db
        .select()
        .from(promoCodesTable)
        .where(eq(promoCodesTable.code, referralCode))
        .limit(1);

      if (!promoCodeRecord) {
        logger.info({ userId: user.id, referralCode }, "Referral code not found — skipping");
      } else if (promoCodeRecord.userId === user.id) {
        logger.warn({ userId: user.id, referralCode }, "Self-referral attempt — rejected");
      } else {
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
              { referrerId: promoCodeRecord.userId, referredUserId: user.id, referralCode },
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
  const response: Record<string, unknown> = {
    token,
    mustChangePassword: user.mustChangePassword,
    requiresOtp: true,
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
  };
  if (process.env.NODE_ENV !== "production") {
    response._devOtp = otp;
  }
  res.status(201).json(response);
});

// ── OTP Verification ──────────────────────────────────────────────────────────
router.post("/auth/verify-otp", authenticate, async (req, res): Promise<void> => {
  const { code } = req.body as { code?: string };
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: "Verification code is required" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (user.phoneVerifiedAt) {
    // Already verified — check subscription state
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.userId, user.id))
      .limit(1);
    res.json({
      message: "Phone already verified",
      trialActivated: sub?.status === "free_trial" || sub?.status === "active",
    });
    return;
  }

  if (!user.otpCode || !user.otpExpiresAt) {
    res.status(400).json({ error: "No verification code found. Please request a new one." });
    return;
  }

  if (new Date() > user.otpExpiresAt) {
    res.status(400).json({ error: "Verification code has expired. Please request a new one." });
    return;
  }

  if (user.otpCode !== code.trim()) {
    res.status(400).json({ error: "Invalid verification code" });
    return;
  }

  // Mark phone as verified and clear OTP
  await db
    .update(usersTable)
    .set({ phoneVerifiedAt: new Date(), otpCode: null, otpExpiresAt: null })
    .where(eq(usersTable.id, user.id));

  // Check trial eligibility
  // 1. Same phone on another account that already used a trial
  const otherUsersWithPhone = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.phone, user.phone), ne(usersTable.id, user.id)));

  let phoneHadTrial = false;
  for (const u of otherUsersWithPhone) {
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.userId, u.id), eq(subscriptionsTable.freeTrialUsed, 1)))
      .limit(1);
    if (sub) { phoneHadTrial = true; break; }
  }

  // 2. Same device fingerprint on another account that already used a trial
  let fingerprintHadTrial = false;
  if (user.deviceFingerprint) {
    const otherUsersWithFp = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.deviceFingerprint, user.deviceFingerprint),
        ne(usersTable.id, user.id),
      ));
    for (const u of otherUsersWithFp) {
      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(and(eq(subscriptionsTable.userId, u.id), eq(subscriptionsTable.freeTrialUsed, 1)))
        .limit(1);
      if (sub) { fingerprintHadTrial = true; break; }
    }
  }

  const eligible = !phoneHadTrial && !fingerprintHadTrial;

  if (eligible) {
    const now = new Date();
    const trialEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    await db
      .update(subscriptionsTable)
      .set({ status: "free_trial", startDate: now, endDate: trialEnd, freeTrialUsed: 1 })
      .where(eq(subscriptionsTable.userId, user.id));

    await createNotification({
      userId: user.id,
      type: "free_trial_activated",
      title: "Welcome — Free Trial Active",
      message:
        "Your 2-day free trial is now active. Add a slave account and bind it to a strategy to start receiving copy trades.",
    });

    logger.info({ userId: user.id, trialEnd }, "OTP verified: 2-day free trial granted");
    res.json({ message: "Phone verified. Free trial activated.", trialActivated: true });
  } else {
    logger.info({ userId: user.id, phoneHadTrial, fingerprintHadTrial }, "OTP verified: trial already used");
    res.json({
      message: "Phone verified successfully.",
      trialActivated: false,
      trialDeniedReason: "Free trial already used. Please subscribe to continue.",
    });
  }
});

// ── Resend OTP ────────────────────────────────────────────────────────────────
router.post("/auth/resend-otp", authenticate, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (user.phoneVerifiedAt) {
    res.status(400).json({ error: "Phone is already verified" });
    return;
  }

  const otp = generateOtp();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db
    .update(usersTable)
    .set({ otpCode: otp, otpExpiresAt })
    .where(eq(usersTable.id, user.id));
  await queueOtpSms(user.id, user.phone, otp);

  logger.info({ userId: user.id }, "OTP resent");

  const response: Record<string, unknown> = {
    message: "A new verification code has been sent to your phone.",
  };
  if (process.env.NODE_ENV !== "production") {
    response._devOtp = otp;
  }
  res.json(response);
});

// ── OTP Status ────────────────────────────────────────────────────────────────
router.get("/auth/otp-status", authenticate, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, user.id))
    .limit(1);

  res.json({
    phoneVerified: !!user.phoneVerifiedAt,
    requiresOtp: !user.phoneVerifiedAt,
    subscriptionStatus: sub?.status ?? "expired",
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────
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
    requiresOtp: !user.phoneVerifiedAt,
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
