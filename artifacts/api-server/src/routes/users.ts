import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { UpdateMeBody } from "@workspace/api-zod";
import { authenticate } from "../middlewares/authenticate";
import { hashPassword } from "../lib/auth";

const router = Router();

router.get("/users/me", authenticate, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    theme: user.theme ?? "dark",
    phoneVerified: !!user.phoneVerifiedAt,
  });
});

router.patch("/users/me", authenticate, async (req, res): Promise<void> => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (parsed.data.name) updates.name = parsed.data.name;
  if (parsed.data.phone) updates.phone = parsed.data.phone;
  if (parsed.data.password) updates.passwordHash = await hashPassword(parsed.data.password);

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.userId!)).returning();

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    theme: user.theme ?? "dark",
    phoneVerified: !!user.phoneVerifiedAt,
  });
});

router.patch("/users/me/theme", authenticate, async (req, res): Promise<void> => {
  const { theme } = req.body as { theme?: string };
  if (!theme || !["dark", "light", "system"].includes(theme)) {
    res.status(400).json({ error: "theme must be one of: dark, light, system" });
    return;
  }

  await db
    .update(usersTable)
    .set({ theme })
    .where(eq(usersTable.id, req.userId!));

  res.json({ theme });
});

export default router;
