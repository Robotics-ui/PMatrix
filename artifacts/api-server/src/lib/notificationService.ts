import { db, notificationsTable } from "@workspace/db";
import { logger } from "./logger";

export async function createNotification(opts: {
  userId: number;
  type: string;
  title: string;
  message: string;
}): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      userId: opts.userId,
      type: opts.type,
      title: opts.title,
      message: opts.message,
    });
  } catch (err) {
    logger.error(
      { err, userId: opts.userId, type: opts.type },
      "Failed to create in-app notification",
    );
  }
}
