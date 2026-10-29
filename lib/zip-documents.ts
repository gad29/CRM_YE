// Packs a set of documents into one ZIP for download.
//
// Files are stored without re-compression (level 0): they are almost all PDFs
// and photos, which are already compressed, so this is fast and costs no CPU.
// Hebrew names are written as UTF-8 (fflate sets the ZIP "language encoding"
// flag for non-ASCII names), so they open correctly on Windows and phones.
import path from 'node:path';
import { zipSync, strToU8, type Zippable } from 'fflate';
import type { DocumentRecord } from '@/lib/domain';
import { readDocumentFile } from '@/lib/store';

/** Characters Windows / macOS refuse in a file or folder name. */
function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'מסמך';
}

/** The name a person sees: the label they gave it, keeping the real extension. */
function displayName(doc: DocumentRecord) {
  const ext = path.extname(doc.originalName);
  const label = doc.label?.trim();
  if (!label) return safeName(doc.originalName);
  return safeName(label.toLowerCase().endsWith(ext.toLowerCase()) ? label : `${label}${ext}`);
}

export interface ZipResult {
  buffer: Uint8Array;
  included: number;
  /** Documents whose file is missing on disk (listed in a note inside the ZIP). */
  missing: string[];
}

/**
 * Build a ZIP. `folderOf` optionally puts each document in a sub-folder (e.g.
 * one folder per case); duplicate names get " (2)", " (3)"…
 */
export function zipDocuments(docs: DocumentRecord[], folderOf?: (doc: DocumentRecord) => string | undefined): ZipResult {
  const tree: Zippable = {};
  const used = new Set<string>();
  const missing: string[] = [];
  let included = 0;

  for (const doc of docs) {
    const file = readDocumentFile(doc);
    if (!file) {
      missing.push(doc.label || doc.originalName);
      continue;
    }
    const folder = folderOf?.(doc);
    const base = displayName(doc);
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    let name = base;
    for (let n = 2; used.has(`${folder ?? ''}/${name}`.toLowerCase()); n += 1) name = `${stem} (${n})${ext}`;
    used.add(`${folder ?? ''}/${name}`.toLowerCase());

    const entry: [Uint8Array, { level: 0; mtime: Date }] = [new Uint8Array(file), { level: 0, mtime: new Date(doc.uploadedAt) }];
    if (folder) {
      const dir = (tree[safeName(folder)] ??= {}) as Zippable;
      dir[name] = entry;
    } else {
      tree[name] = entry;
    }
    included += 1;
  }

  if (missing.length) {
    tree['קבצים חסרים.txt'] = strToU8(`הקבצים הבאים לא נמצאו בשרת ולכן לא נכללו:\r\n${missing.join('\r\n')}\r\n`);
  }
  return { buffer: zipSync(tree), included, missing };
}

/** HTTP headers for sending the ZIP as a download with a Hebrew file name. */
export function zipHeaders(fileName: string, size: number) {
  const name = `${safeName(fileName)}.zip`;
  return {
    'Content-Type': 'application/zip',
    'Content-Length': String(size),
    // ASCII fallback first, then the real UTF-8 name for every modern browser.
    'Content-Disposition': `attachment; filename="documents.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}
