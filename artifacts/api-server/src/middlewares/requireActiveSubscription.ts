import { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, subscriptionsTable } from "@workspace/db";

export async function requireActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.userId!;
  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);

  if (!sub || (sub.status !== "active" && sub.status !== "free_trial")) {
    res.status(403).json({
      error: "Subscription expired. Please renew to continue.",
      subscriptionStatus: sub?.status ?? "none",
    });
    return;
  }
  next();
}
