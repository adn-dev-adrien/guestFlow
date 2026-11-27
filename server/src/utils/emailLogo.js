/**
 * The company logo as a guest email carries it (specs/emails/guest-email-branding.md rules 2–3).
 *
 * `emailLogoPng(storedPath)` → the stored logo (`/uploads/<file>`, day or night) resized to 144 px high
 * (a 2× image for the 72 px it is drawn at) and written as PNG, or null when nothing is stored or the file
 * cannot be read or decoded: an email without its logo still leaves. The result is cached by path and
 * modification time, so a sequence run decodes the file once and a re-upload is seen at once.
 *
 * `emailLogoDataUri(storedPath)` → the stored file itself as a `data:` URI, read synchronously, for the preview:
 * a sandboxed frame cannot resolve `cid:` (guest-email-branding rule 8), and the preview handlers stay synchronous.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { uploadsDir } = require('./instancePaths');
const { imageFormatOf } = require('./uploadSafety');

const HEIGHT = 144;
const cache = new Map();
const dataUriCache = new Map();

async function emailLogoPng(storedPath) {
  const stored = String(storedPath || '').trim();
  if (!stored) return null;
  const file = path.join(uploadsDir(), path.basename(stored));
  let mtimeMs;
  try { mtimeMs = fs.statSync(file).mtimeMs; } catch (_) { return null; }
  const key = `${file}:${mtimeMs}`;
  if (cache.has(key)) return cache.get(key);
  let bytes = null;
  try {
    bytes = await sharp(fs.readFileSync(file), { failOn: 'error' }).rotate()
      .resize({ height: HEIGHT, withoutEnlargement: true }).png().toBuffer();
  } catch (err) {
    console.error('[guestEmail] logo unreadable, email without it:', path.basename(file), err && err.code);
  }
  for (const k of cache.keys()) if (k.startsWith(`${file}:`)) cache.delete(k);
  cache.set(key, bytes);
  return bytes;
}

function emailLogoDataUri(storedPath) {
  const stored = String(storedPath || '').trim();
  if (!stored) return null;
  const file = path.join(uploadsDir(), path.basename(stored));
  try {
    const key = `${file}:${fs.statSync(file).mtimeMs}`;
    if (dataUriCache.has(key)) return dataUriCache.get(key);
    const bytes = fs.readFileSync(file);
    const format = imageFormatOf(bytes);
    const uri = format ? `data:image/${format};base64,${bytes.toString('base64')}` : null;
    for (const k of dataUriCache.keys()) if (k.startsWith(`${file}:`)) dataUriCache.delete(k);
    dataUriCache.set(key, uri);
    return uri;
  } catch (_) {
    return null;
  }
}

module.exports = { emailLogoPng, emailLogoDataUri, LOGO_HEIGHT: HEIGHT };
