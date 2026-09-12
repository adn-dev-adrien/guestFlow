// The guest page itself (specs/guest-gate-access.md §4.2, §6).
//
// Served straight from disk by express, not from the client build: it is 21 kB of HTML, CSS and
// vanilla JS, and loading the operator's SPA to draw one button — on a phone, at a gate, in the
// rain — would be indefensible. It exists only on the guest hostname; `guestTreeOnly` answers 404
// everywhere else, including for the assets.
//
// The home-screen icons are derived from the company logo already uploaded in Réglages, the same
// source the favicon uses (middleware/dynamicFavicon.js), resized with sharp. With no logo
// configured, a monogram on the sapin ground stands in — the page must be installable on a fresh
// instance too.

const express = require('express');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const router = express.Router();
const settingsModel = require('../models/settingsModel');
const { uploadsDir } = require('../middleware/multerLogoUpload');

const PAGE_DIR = path.join(__dirname, '..', 'guest-page');
const UPLOADS_ABS = path.resolve(uploadsDir);
const ICON_CACHE = new Map();   // size → { buffer, key }

/**
 * Serves `handler` only on the guest hostname, and otherwise **falls through**.
 *
 * Not `guestTreeOnly`: this router is mounted at the root, so a middleware that answered 404 for
 * every non-guest request would swallow the entire admin application — which is exactly what it did
 * until the first real run caught it. The API trees can afford a wall because they own their
 * prefix; a router at `/` has to step aside.
 */
function onGuestHost(handler) {
  return function guestHostOnly(req, res, next) {
    if (!req.isGuestHost) return next();
    return handler(req, res, next);
  };
}

/**
 * Caching, and why there is so little of it: these filenames carry NO fingerprint, so a long
 * max-age means a guest keeps running yesterday's JS against today's API for as long as it lasts —
 * and the one page you never want stale is the one that opens a gate. The shell is `no-store`; the
 * assets are `no-cache`, which is not "no caching" but "revalidate every time": sendFile emits an
 * ETag, so the answer is a 304 of a few bytes, not the file. Deploy safety for the price of one
 * conditional request.
 */
router.get('/', onGuestHost((req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('html').sendFile(path.join(PAGE_DIR, 'index.html'));
}));

router.get('/gate/style.css', onGuestHost((req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('css').sendFile(path.join(PAGE_DIR, 'style.css'));
}));

router.get('/gate/app.js', onGuestHost((req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('js').sendFile(path.join(PAGE_DIR, 'app.js'));
}));

router.get('/gate/manifest.webmanifest', onGuestHost((req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/manifest+json').sendFile(path.join(PAGE_DIR, 'manifest.webmanifest'));
}));

/** The uploaded logo, resolved defensively — a tampered settings row must not escape uploads/. */
function logoFile() {
  let row;
  try { row = settingsModel.read(); } catch { return null; }
  const stored = row && typeof row.companyLogoPath === 'string' ? row.companyLogoPath.trim() : '';
  if (!stored) return null;
  const basename = path.basename(stored);
  if (!basename || basename === '.' || basename === '..') return null;
  const resolved = path.resolve(UPLOADS_ABS, basename);
  if (!resolved.startsWith(UPLOADS_ABS + path.sep)) return null;
  return fs.existsSync(resolved) ? resolved : null;
}

/** A monogram, for an instance with no logo yet: the site's ground, the site's ocre. */
function monogram(size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="#2E3B2A"/>
    <text x="50%" y="50%" dy=".35em" text-anchor="middle" fill="#E8C286"
          font-family="Georgia, serif" font-size="${Math.round(size * 0.5)}">S</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function iconFor(size) {
  const source = logoFile();
  const key = source ? `${source}:${fs.statSync(source).mtimeMs}` : 'monogram';
  const cached = ICON_CACHE.get(size);
  if (cached && cached.key === key) return cached.buffer;

  let buffer;
  if (source) {
    buffer = await sharp(source)
      .resize(size, size, { fit: 'contain', background: { r: 245, g: 240, b: 230, alpha: 1 } })
      .png()
      .toBuffer();
  } else {
    buffer = await monogram(size);
  }
  ICON_CACHE.set(size, { buffer, key });
  return buffer;
}

for (const size of [192, 512]) {
  router.get(`/gate/icon-${size}.png`, onGuestHost(async (req, res) => {
    try {
      const buffer = await iconFor(size);
      res.set('Cache-Control', 'public, max-age=300');
      res.type('png').send(buffer);
    } catch (err) {
      // An icon is never worth a 500 on the page that opens a gate.
      res.status(404).end();
    }
  }));
}

module.exports = router;
