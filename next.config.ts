import type { NextConfig } from 'next';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV !== 'production';

// Everything the UI needs is same-origin: fonts are self-hosted by next/font,
// the PDF worker is served from /public, and blob: covers the PDF editor and
// voice-note previews. 'unsafe-inline' scripts are required by Next's inline
// bootstrap and the theme-init snippet; 'unsafe-eval' only for dev hot reload.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Microphone stays available to this site for chat voice notes.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }]),
];

const nextConfig: NextConfig = {
  output: 'standalone',
  typedRoutes: true,
  poweredByHeader: false,
  // Avoid picking a parent-folder lockfile as the tracing root (common when ~/package-lock.json exists).
  outputFileTracingRoot: path.join(__dirname),
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Pages only — API file downloads and the share page set their own, stricter CSP.
      { source: '/((?!api/).*)', headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy }] },
    ];
  },
};

export default nextConfig;
