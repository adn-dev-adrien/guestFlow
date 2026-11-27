/**
 * The company logo as a guest email carries it (specs/emails/guest-email-branding.md rules 2–3).
 *
 * `emailLogoPng(storedPath)` → `{ bytes, width, height }` or null: the stored logo (`/uploads/<file>`, day or night)
 * fitted inside 1040×144 (a 2× image for the 520×72 it is drawn in) and written as PNG; `width` and `height` are
 * those of the bytes. Null when nothing is stored or the file cannot be read or decoded: an email without its logo
 * still leaves. Cached by path and modification time, so a sequence run decodes the file once and a re-upload is seen at once.
 *
 * `cachedEmailLogo(storedPath)` → the cached result, read synchronously (null when cold), and `warmEmailLogos(settings)`
 * → a promise filling the cache for both logos, or null when it is already warm: the preview handlers stay
 * synchronous, and wait only when a logo has to be read first (a `data:` URI of these same bytes, never of the
 * unresized file).
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { uploadsDir } = require('./instancePaths');

const MAX_WIDTH = 1040;
const HEIGHT = 144;
const cache = new Map();

function keyOf(storedPath) {
  const stored = String(storedPath || '').trim();
  if (!stored) return null;
  const file = path.join(uploadsDir(), path.basename(stored));
  try { return { file, key: `${file}:${fs.statSync(file).mtimeMs}` }; } catch (_) { return null; }
}

function cachedEmailLogo(storedPath) {
  const at = keyOf(storedPath);
  return at && cache.has(at.key) ? cache.get(at.key) : null;
}

async function emailLogoPng(storedPath) {
  const at = keyOf(storedPath);
  if (!at) return null;
  if (cache.has(at.key)) return cache.get(at.key);
  let logo = null;
  try {
    const { data, info } = await sharp(fs.readFileSync(at.file), { failOn: 'error' }).rotate()
      .resize({ width: MAX_WIDTH, height: HEIGHT, fit: 'inside', withoutEnlargement: true })
      .png().toBuffer({ resolveWithObject: true });
    logo = { bytes: data, width: info.width, height: info.height };
  } catch (err) {
    console.error('[guestEmail] logo unreadable, email without it:', path.basename(at.file), err && err.code);
  }
  for (const k of cache.keys()) if (k.startsWith(`${at.file}:`)) cache.delete(k);
  cache.set(at.key, logo);
  return logo;
}

function warmEmailLogos(settings) {
  const paths = [settings && settings.companyLogoPath, settings && settings.companyLogoDarkPath].filter(Boolean);
  const cold = paths.filter((p) => { const at = keyOf(p); return at && !cache.has(at.key); });
  return cold.length ? Promise.all(cold.map(emailLogoPng)) : null;
}

module.exports = { emailLogoPng, cachedEmailLogo, warmEmailLogos, LOGO_HEIGHT: HEIGHT };
