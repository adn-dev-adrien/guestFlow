/**
 * A photo uploaded from the studio (specs/guest-app.md §5, rule 48): read by sharp — the declared type is a
 * hint, the decoded format decides — turned the right way up, and written as three WebP widths (1600, 800,
 * 400 px, never enlarged) under `<uploads>/guest-app/`. The mobile width is the one the offline booklet caches
 * (rule 21).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { WIDTHS, variantPaths } = require('./models/mediaModel');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);
const ACCEPTED_FORMATS = Object.freeze(['jpeg', 'png', 'webp']);
// A decompression bomb is refused before it is decoded: 50 megapixels covers any camera.
const MAX_PIXELS = 50 * 1000 * 1000;
const FOLDER = 'guest-app';
const QUALITY = 80;

class MediaError extends Error {}

/** → { path, width, height } of the largest copy. Throws MediaError for a file that is not a usable photo. */
async function storeImage(buffer, uploadsDir) {
  let metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw new MediaError('Ce fichier n’est pas une image lisible.');
  }
  if (!ACCEPTED_FORMATS.includes(metadata.format)) throw new MediaError('Formats acceptés : JPG, PNG, WEBP.');
  const name = `${FOLDER}/${crypto.randomBytes(12).toString('hex')}.webp`;
  const paths = variantPaths(name);
  fs.mkdirSync(path.join(uploadsDir, FOLDER), { recursive: true });
  const written = [];
  try {
    let largest = null;
    for (const width of WIDTHS) {
      const target = path.join(uploadsDir, paths[width]);
      // eslint-disable-next-line no-await-in-loop
      const info = await sharp(buffer, { limitInputPixels: MAX_PIXELS })
        .rotate()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(target);
      written.push(target);
      if (!largest) largest = info;
    }
    return { path: name, width: largest.width, height: largest.height };
  } catch {
    written.forEach((file) => fs.rmSync(file, { force: true }));
    throw new MediaError('Ce fichier n’est pas une image lisible.');
  }
}

/** Rule 59 — « Effacer aussi ses données »: every photo the plugin wrote, its folder under the uploads included. */
function eraseAll(uploadsDir) {
  if (!uploadsDir) return;
  fs.rmSync(path.join(uploadsDir, FOLDER), { recursive: true, force: true });
}

module.exports = {
  ACCEPTED_TYPES, MAX_UPLOAD_BYTES, MediaError, eraseAll, storeImage,
};
