/**
 * The image of a visual (specs/gift-voucher-campaigns.md rule 47): judged by what sharp decodes — the declared type is a hint — and kept exactly as received, never
 * recompressed for print. A JPEG or a PNG, in the A6 portrait ratio within 2 %, of at least 1240 × 1748 px (300 dpi); anything else is refused with its measured size.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const MIN_WIDTH = 1240;
const MIN_HEIGHT = 1748;
const A6_RATIO = 105 / 148;
const RATIO_TOLERANCE = 0.02;
const MAX_PIXELS = 100 * 1000 * 1000;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const EXTENSIONS = Object.freeze({ jpeg: '.jpg', png: '.png' });
const THUMBNAIL_WIDTH = 480;

const unreadable = { ok: false, message: 'Ce fichier n’est pas une image lisible.' };

/** → `{ ok: true, width, height, format }` or `{ ok: false, message }` (the sentence the operator reads). */
async function inspect(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    return unreadable;
  }
  if (!EXTENSIONS[metadata.format]) return { ok: false, message: 'Formats acceptés : JPEG ou PNG.' };
  // An EXIF orientation of 5 to 8 turns the picture on its side: the printer sees the turned size.
  const turned = metadata.orientation >= 5;
  const width = turned ? metadata.height : metadata.width;
  const height = turned ? metadata.width : metadata.height;
  const proportioned = Math.abs(width / height - A6_RATIO) / A6_RATIO <= RATIO_TOLERANCE;
  if (!width || !height || width < MIN_WIDTH || height < MIN_HEIGHT || !proportioned) {
    return { ok: false, message: `Image trop petite ou mal proportionnée : ${width} × ${height} px. Il faut au moins ${MIN_WIDTH} × ${MIN_HEIGHT} px, format A6 portrait.` };
  }
  return {
    ok: true, width, height, format: metadata.format,
  };
}

/** Writes the bytes as received under `dir`. → the file name kept in the version row. */
function store(buffer, dir, format) {
  fs.mkdirSync(dir, { recursive: true });
  const name = `${crypto.randomBytes(12).toString('hex')}${EXTENSIONS[format]}`;
  fs.writeFileSync(path.join(dir, name), buffer);
  return name;
}

const read = (dir, name) => fs.readFileSync(path.join(dir, path.basename(name)));
const remove = (dir, name) => fs.rmSync(path.join(dir, path.basename(name)), { force: true });
const thumbnail = (buffer) => sharp(buffer, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();

module.exports = {
  inspect, store, read, remove, thumbnail, MIN_WIDTH, MIN_HEIGHT, MAX_UPLOAD_BYTES,
};
