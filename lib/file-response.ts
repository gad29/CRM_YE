// One place that decides how an uploaded file is sent back to a browser.
//
// The stored MIME type comes from the uploader's browser, so it can't be
// trusted: an "image" that is really HTML/SVG, served inline from this origin,
// would run script with the viewer's session (a worker could take over an
// admin account that way). So only a short allowlist renders inline, and
// everything is sent with nosniff plus a sandboxing CSP.
import path from 'node:path';
import { NextResponse } from 'next/server';

const INLINE_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg', '.jfif'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'audio/webm': ['.webm', '.weba'],
  'audio/ogg': ['.ogg', '.oga', '.opus'],
  'audio/mpeg': ['.mp3'],
  'audio/mp4': ['.m4a', '.mp4'],
  'audio/wav': ['.wav'],
  'video/webm': ['.webm'],
};

function baseType(mimeType: string) {
  return (mimeType || '').split(';')[0].trim().toLowerCase();
}

/** Inline only when both the declared type and the file extension are on the allowlist and agree. */
export function canRenderInline(mimeType: string, fileName: string) {
  const extensions = INLINE_TYPES[baseType(mimeType)];
  if (!extensions) return false;
  return extensions.includes(path.extname(fileName).toLowerCase());
}

export function fileResponse(
  buffer: Buffer,
  input: { mimeType: string; fileName: string; download?: boolean },
) {
  const inline = !input.download && canRenderInline(input.mimeType, input.fileName);
  const type = baseType(input.mimeType);
  const contentType = inline ? type : 'application/octet-stream';
  const encodedName = encodeURIComponent(input.fileName);
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(buffer.length),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  // Chrome's built-in PDF viewer breaks under a restrictive CSP, and PDFs can't
  // run script on this origin anyway — every other response is sandboxed.
  if (!(inline && type === 'application/pdf')) {
    headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox";
  }
  return new NextResponse(new Uint8Array(buffer), { headers });
}
