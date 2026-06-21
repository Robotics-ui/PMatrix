---
name: OTP free trial flow
description: How OTP phone verification gates the 2-day free trial — register flow, verify-otp endpoint, GuestRoute workaround.
---

## Flow
1. **POST /auth/register** — creates user, creates "expired" subscription (no trial yet), generates 6-digit OTP, queues SMS, returns `requiresOtp: true` and `_devOtp` (in non-production only).
2. **Frontend (register.tsx)** — on register success with `requiresOtp: true`: stores token in local state (`pendingToken`), does NOT call `login()` yet (prevents GuestRoute redirect), shows OTP verification step.
3. **POST /auth/verify-otp** (authenticated) — verifies OTP, checks trial eligibility (same phone/fingerprint on another account with freeTrialUsed=1), upgrades subscription to "free_trial" if eligible.
4. **Frontend (register.tsx)** — on verify success: calls `login(pendingToken)` then navigates to /dashboard.

## Trial abuse checks (in verify-otp)
- Same phone on another account with freeTrialUsed=1 → denied
- Same deviceFingerprint on another account with freeTrialUsed=1 → denied
- Same mt5Login on another slave account whose owner had freeTrialUsed=1 → denied at slave account creation

## Key design decision: pendingToken pattern
The register page stores the token in local component state (`useState`) until OTP is verified. This prevents GuestRoute from redirecting to /dashboard prematurely.
Calling `login(token)` sets token in AuthContext, which triggers GuestRoute's `if (token) return <Redirect to="/dashboard" />`. So we delay `login()` until OTP verification is complete.

## Endpoints
- POST /auth/register — creates user, sends OTP
- POST /auth/verify-otp — requires Bearer token from register response
- POST /auth/resend-otp — requires Bearer token, regenerates OTP
- GET /auth/otp-status — returns { phoneVerified, requiresOtp, subscriptionStatus }
