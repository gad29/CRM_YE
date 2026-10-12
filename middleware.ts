import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
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
  if (pathname === '/api/health') return true;
  // Shared document links are token-protected inside the route.
  if (pathname.startsWith('/api/share/')) return true;
  // Meta delivery-status webhook — verified by its X-Hub-Signature-256.
  if (pathname === '/api/webhooks/whatsapp') return true;
  return false;
}

/** Pages and APIs reserved for admins (workers are redirected / rejected). */
function isAdminOnlyPath(pathname: string) {
  return (
    pathname === '/payments' ||
    pathname.startsWith('/payments/') ||
    pathname === '/workers' ||
    pathname.startsWith('/workers/') ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/') ||
    pathname === '/connections' ||
    pathname.startsWith('/api/payments') ||
    pathname.startsWith('/api/workers') ||
    pathname.startsWith('/api/admins') ||
    pathname.startsWith('/api/settings') ||
    pathname.startsWith('/api/import') ||
    pathname.startsWith('/api/integrations')
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

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

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
      return NextResponse.redirect(new URL('/dashboard', request.url));
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
