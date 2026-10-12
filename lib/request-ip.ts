import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';

/**
 * The client's IP as reported by OUR reverse proxy. CLIENT_IP_HEADER names the
 * header it sets (nginx/CloudPanel: x-real-ip; Caddy: x-forwarded-for). For
 * X-Forwarded-For the right-most entry is the one our proxy appended — the
 * left-most can be anything the client chose to send.
 */
export function clientIp(request: NextRequest | Request) {
  const raw = request.headers.get(env.clientIpHeader) || '';
  if (!raw) return 'unknown';
  if (env.clientIpHeader === 'x-forwarded-for') {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    return parts[parts.length - 1] || 'unknown';
  }
  return raw.trim();
}
