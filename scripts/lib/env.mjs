// Loads the same .env files Next.js would, for standalone Node scripts.
// Existing process.env values always win (Docker / pm2 env take precedence).
import fs from 'node:fs';
import path from 'node:path';

function parse(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(cwd = process.cwd()) {
  // Scripts are often run by hand on the server with NODE_ENV unset; there the
  // settings live in .env.production.local, so treat its presence as production.
  const mode =
    process.env.NODE_ENV === 'production' ||
    (!process.env.NODE_ENV && fs.existsSync(path.join(cwd, '.env.production.local')))
      ? 'production'
      : 'development';
  // Same precedence as Next.js: the first file to define a key wins.
  const files = [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env'];
  for (const name of files) {
    const file = path.join(cwd, name);
    if (!fs.existsSync(file)) continue;
    for (const [key, value] of Object.entries(parse(fs.readFileSync(file, 'utf8')))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
