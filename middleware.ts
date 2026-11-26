import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { bearerToken, KEY_METHOD_HEADER, KEY_PATH_HEADER, keyRequestProblem } from '@/lib/api-access';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session-token';

// Edge runtime: a cheap, stateless gate (signature + scope) for pages and
// admin-only areas. Every route handler re-checks the session row in
// PostgreSQL, so revoked sessions get no data even though they pass here.

const APP_BASE_URL = process.env.APP_BASE_URL || '';

/** Paths that stay reachable without a session. */
function isPublicPath(pathname: string) {
  if (pathname === '/login' || pathname === '/forgot') return true;
  if (pathname === '/api/auth/login' || pathname === '/api/auth/me') return true;
  if (pathname === '/api/auth/forgot' || pathname === '/api/auth/reset') return true;
  if (pathname === '/api/health' || pathname === '/api/branding') return true;
  // The shape of the API for bot tools; no data in it.
  if (pathname === '/api/openapi.json') return true;
  // Shared document links are token-protected inside the route.
  if (pathname.startsWith('/api/share/')) return true;
  // Meta delivery-status webhook — verified by its X-Hub-Signature-256.
  if (pathname === '/api/webhooks/whatsapp') return true;
  return false;
}

/** Pages and APIs reserved for admins (workers are redirected / rejected). */
function isAdminOnlyPath(pathname: string) {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  return (
    under('/admin') ||
    under('/payments') ||
    under('/api/payments') ||
    under('/api/users') ||
    under('/api/settings') ||
    under('/api/import') ||
    under('/api/integrations') ||
    under('/api/activity') ||
    under('/api/api-keys')
  );
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cross-site request forgery guard for state-changing requests. SameSite=Lax
 * already keeps the cookie off most cross-site POSTs; this also refuses any
 * request a browser labels as coming from another site.
 */
function isCrossSiteWrite(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return false;
  const origin = request.headers.get('origin');
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return true;
    }
    const allowed = new Set<string>();
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    if (host) allowed.add(host);
    try {
      if (APP_BASE_URL) allowed.add(new URL(APP_BASE_URL).host);
    } catch {
      /* ignore a malformed APP_BASE_URL here; startup validation reports it */
    }
    return !allowed.has(originHost);
  }
  return request.headers.get('sec-fetch-site') === 'cross-site';
}

/**
 * A request carrying an API key (a bot): only the API paths keys may use
 * (lib/api-access.ts). The route handler checks the key itself. The cookie is
 * dropped so a key request never rides on a browser session, and the method
 * and path are passed on for the read-only check.
 */
function apiKeyRequest(request: NextRequest, pathname: string) {
  if (!pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'מפתח API פותח רק את ה-API, לא את מסכי המערכת' }, { status: 401 });
  }
  const problem = keyRequestProblem(request.method, pathname);
  if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 403 });
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.set(KEY_METHOD_HEADER, request.method);
  headers.set(KEY_PATH_HEADER, pathname);
  return NextResponse.next({ request: { headers } });
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Browsers never attach an Authorization header on their own, so a key
  // request can't be forged cross-site; the CSRF guard is for the cookie.
  if (bearerToken(request.headers.get('authorization')) !== null) {
    return isPublicPath(pathname) ? NextResponse.next() : apiKeyRequest(request, pathname);
  }

  if (pathname !== '/api/webhooks/whatsapp' && isCrossSiteWrite(request)) {
    return NextResponse.json({ ok: false, error: 'Cross-site request blocked' }, { status: 403 });
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (session) {
    if (session.scope === 'worker' && isAdminOnlyPath(pathname)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/today', request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'Sign-in required' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  const response = NextResponse.redirect(loginUrl);
  // A cookie with a bad signature is just noise — drop it.
  if (request.cookies.get(SESSION_COOKIE)) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const config = {
  // Protect everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|pdf.worker.min.mjs|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};
