// What a program holding an API key (an AI bot, an automation) may reach.
// Edge-safe: the middleware checks the path here before anything else, and
// the route handlers then check the key itself in PostgreSQL (lib/api-keys.ts).

export const API_KEY_PREFIX = 'crmye_';

/** Set by the middleware (client-sent copies are dropped) so getViewer knows what a key is asking for. */
export const KEY_METHOD_HEADER = 'x-crmye-key-method';
export const KEY_PATH_HEADER = 'x-crmye-key-path';

/** The key in "Authorization: Bearer …", or null when the request carries none. */
export function bearerToken(header: string | null | undefined) {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Working data: a key with write access may also change it here (never delete). */
const KEY_PATHS = [
  /^\/api\/mcp$/,
  /^\/api\/clients(\/|$)/,
  /^\/api\/cases(\/|$)/,
  /^\/api\/documents(\/|$)/,
  /^\/api\/tasks(\/|$)/,
  /^\/api\/payments(\/|$)/,
  /^\/api\/chat(\/|$)/,
];

/** Readable with a key, never changeable with one (settings, the activity log). */
const KEY_READ_PATHS = [/^\/api\/config$/, /^\/api\/activity$/, /^\/api\/templates\/blank-contract$/];

const READ_METHODS = new Set(['GET', 'HEAD']);

export function isReadMethod(method: string) {
  return READ_METHODS.has(method.toUpperCase());
}

/**
 * Why a key may not make this request, or null when the path is open to keys.
 * Accounts, passwords, team members, settings and the keys themselves stay
 * browser-only, and a key never deletes anything.
 */
export function keyRequestProblem(method: string, pathname: string): string | null {
  const m = method.toUpperCase();
  if (m === 'DELETE') return 'מפתח API לא יכול למחוק. מחיקה נעשית רק מתוך המערכת';
  if (KEY_PATHS.some((r) => r.test(pathname))) return null;
  if (KEY_READ_PATHS.some((r) => r.test(pathname))) return READ_METHODS.has(m) ? null : 'את זה אפשר רק לקרוא עם מפתח API, לא לשנות';
  return 'האזור הזה לא פתוח למפתחות API';
}
