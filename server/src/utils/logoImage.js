/**
 * The company logo as the devis PDF reads it (specs/settings.md rule 8).
 *
 * - `printableLogo(buffer)` → `{ bytes, ext }`: a PNG or a JPEG by its first bytes, decoded whole by the image library and
 *   written again by it (orientation applied, at most 1200 px a side), or null. PDFKit reads only bytes sharp wrote: its own PNG reader inflates the
 *   alpha channel itself and throws outside any caller on a stream sharp still decodes (audit R24 verification N1).
 * - `readableLogo(settings)` → the stored logo made printable for the PDF, or null with a log line when it cannot be.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { uploadsDir } = require('./instancePaths');
const { imageFormatOf } = require('./uploadSafety');

const EXTENSION = { png: '.png', jpeg: '.jpg' };

async function printableLogo(buffer) {
  const format = imageFormatOf(buffer);
  if (!format) return null;
  try {
    // The PDF draws the logo at 100×60 pt: a huge one is cut down here, or each PDF costs seconds and gigabytes.
    const image = sharp(buffer, { failOn: 'error' }).rotate()
      .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true });
    const bytes = await (format === 'png' ? image.png() : image.jpeg({ quality: 92 })).toBuffer();
    return { bytes, ext: EXTENSION[format] };
  } catch (_) {
    return null;
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
  const printable = await printableLogo(bytes);
  if (printable) return printable.bytes;
  console.error('[devisPdf] logo not decodable, PDF without it:', path.basename(file));
  return null;
}

module.exports = { printableLogo, readableLogo };
