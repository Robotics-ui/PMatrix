import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.SESSION_SECRET ?? "pesamatrix-secret-key";
const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(userId: number, role: string): string {
  return jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyToken(token: string): { sub: number; role: string } {
  const payload = jwt.verify(token, JWT_SECRET) as unknown as { sub: number; role: string };
  return payload;
}

export function encryptCredential(plain: string): string {
  // Simple base64 for demo — in production use proper AES encryption
  return Buffer.from(plain).toString("base64");
}

export function decryptCredential(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf8");
}
