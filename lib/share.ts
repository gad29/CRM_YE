// Signed, expiring links for sharing a document with a client without login.
// Same secret as the session cookie (ADMIN_SESSION_SECRET): moving the app to
// another server with that secret unchanged keeps already-sent links working.
import crypto from 'node:crypto';
import { signingSecret } from '@/lib/session-token';

function base64url(input: string) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function decodeBase64url(input: string) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(encoded: string) {
  return crypto.createHmac('sha256', signingSecret()).update(encoded).digest('base64url');
}

/** Create a share token for one or more documents, valid for `ttlDays` (default 14). */
export function signShareToken(documentIds: string[], ttlDays = 14) {
  const payload = { ids: documentIds, exp: Date.now() + ttlDays * 24 * 60 * 60 * 1000 };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

/** Single-document convenience wrapper. */
export function signDocumentShareToken(documentId: string, ttlDays = 14) {
  return signShareToken([documentId], ttlDays);
}

/** Verify a share token; returns the authorized document ids when valid and unexpired.
 *  Accepts both the new multi-doc payload ({ ids }) and the old single-doc one ({ d }). */
export function parseShareToken(token: string): { documentIds: string[] } | null {
  const [encoded, signature] = (token || '').split('.');
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  const actual = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (actual.length !== want.length || !crypto.timingSafeEqual(actual, want)) return null;

  try {
    const payload = JSON.parse(decodeBase64url(encoded)) as { d?: string; ids?: string[]; exp?: number };
    if (!payload.exp || Date.now() > payload.exp) return null;
    const ids = payload.ids ?? (payload.d ? [payload.d] : []);
    if (!ids.length) return null;
    return { documentIds: ids };
  } catch {
    return null;
  }
}
