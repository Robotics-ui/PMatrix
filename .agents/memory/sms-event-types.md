---
name: SMS event type registry
description: New SMS event types must be added to the SMS_EVENT_TYPES const array before they can be used in smsNotifier.ts.
---

## Rule
Any new `eventType` passed to `enqueueEventSms()` must first be added to `SMS_EVENT_TYPES` in `lib/db/src/schema/smsTemplates.ts`.

**Why:** `SmsEventType` is a TypeScript `as const` union derived from that array. Using an unlisted string literal in `smsNotifier.ts` causes TS2322 at compile time.

**How to apply:** Before creating a new `notifyX()` function in smsNotifier.ts, add the event type string to the SMS_EVENT_TYPES array. The SMS templates themselves are seeded separately in smsService.ts `seedDefaultTemplates()` or added via the admin UI — missing templates are silently skipped (no SMS sent, in-app notification still fires).

## Current event types (as of June 2026)
- subscription_activated, subscription_expiring, subscription_expired
- payment_received, master_account_approved, account_suspended
- announcement, broadcast
- free_trial_activated, free_trial_expired, referral_reward
