/**
 * The company logo as the devis PDF reads it (specs/settings.md rule 8).
 *
 * - `logoDecodes(buffer)` → true when the image library reads the whole image: a truncated or garbled file is refused
 *   at upload, and skipped by the PDF, whose own PNG reader throws outside any caller on a garbled alpha image.
 * - `readableLogo(settings)` → the stored logo's bytes for the PDF, or null with a log line when it cannot be read.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { uploadsDir } = require('./instancePaths');

async function logoDecodes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  try {
    await sharp(buffer, { failOn: 'error' }).resize({ width: 32, height: 32, fit: 'inside' }).raw().toBuffer();
    return true;
  } catch (_) {
    return false;
  }
}

async function readableLogo(settings) {
  const stored = settings && settings.companyLogoPath;
  if (!stored) return null;
  const file = path.join(uploadsDir(), path.basename(String(stored)));
  if (!fs.existsSync(file)) return null;
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (err) {
    console.error('[devisPdf] logo unreadable, PDF without it:', err && err.code);
    return null;
  }
  if (await logoDecodes(bytes)) return bytes;
  console.error('[devisPdf] logo not decodable, PDF without it:', path.basename(file));
  return null;
}

module.exports = { logoDecodes, readableLogo };
