// Session cookie format, shared by the edge middleware and the Node server.
// Edge-safe: Web Crypto only, no Node imports.
//
//   <session id>.<scope>.<HMAC-SHA256 of "id.scope">
//
// The middleware checks the signature and scope (cheap, no database) to gate
// pages and admin-only areas. Every route handler then confirms the session
// row in PostgreSQL (lib/admin-session.ts), which is what makes sign-out,
// deactivation and password changes take effect immediately.

export const SESSION_COOKIE = 'crmye-admin-session';

export type TokenScope = 'admin' | 'worker';

const encoder = new TextEncoder();

/** Secret for signing cookies and share links. Never a hardcoded default. */
export function signingSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not set — refusing to sign sessions with a guessable key.');
  return secret;
}

function toBase64Url(bytes: ArrayBuffer) {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(signingSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function signSessionToken(sid: string, scope: TokenScope) {
  return `${sid}.${scope}.${await hmac(`${sid}.${scope}`)}`;
}

/** Signature + shape check only — callers that grant data access must also check the database. */
export async function verifySessionToken(token: string | undefined | null): Promise<{ sid: string; scope: TokenScope } | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [sid, scope, signature] = parts;
  if (!sid || (scope !== 'admin' && scope !== 'worker')) return null;
  let expected: string;
  try {
    expected = await hmac(`${sid}.${scope}`);
  } catch {
    return null;
  }
  return constantTimeEqual(signature, expected) ? { sid, scope } : null;
}
