// Password verification for the root admin login (Node runtime only — uses bcryptjs).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '@/lib/env';

/** Minimum length for passwords set in the app (workers, extra admins, resets). */
export const MIN_PASSWORD_LENGTH = 8;
/** bcrypt work factor for newly hashed passwords. */
export const PASSWORD_HASH_ROUNDS = 12;

export async function verifyAdminPassword(password: string) {
  if (!password) return false;
  if (env.adminPasswordHash) {
    try {
      return await bcrypt.compare(password, env.adminPasswordHash);
    } catch {
      return false;
    }
  }
  if (env.adminPassword) {
    // Hash both sides first so the comparison is constant-time regardless of length.
    const given = crypto.createHash('sha256').update(password).digest();
    const expected = crypto.createHash('sha256').update(env.adminPassword).digest();
    return crypto.timingSafeEqual(given, expected);
  }
  return false;
}
