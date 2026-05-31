/**
 * Express handler that serves the configured company logo as the site favicon.
 *
 * Mounted on `GET /favicon.ico` AND `GET /favicon.svg` BEFORE the static-build middleware. If the
 * admin has uploaded a logo via Settings → "Informations sur votre activité", we serve that file
 * (with the right MIME header and a short cache). If no logo is set, or the file no longer exists
 * on disk, we call `next()` so `express.static(clientBuildDir)` serves the bundled default.
 *
 * Path safety: `companyLogoPath` is stored by the upload route as `/uploads/<basename>` with a
 * fixed filename pattern (`company-logo.<ext>`) — we still defend in depth with
 * `path.basename()` to strip any leading `..` / absolute path, then `path.resolve` to make sure
 * the final path stays inside the configured uploads directory. A tampered DB row that pointed at
 * `/etc/passwd` or `../../foo` would never escape `uploads/`.
 *
 * Cache: 5 minutes. Short enough that a fresh logo upload propagates within minutes without us
 * hitting disk on every favicon request (browsers re-request favicons aggressively, especially
 * Safari on new tabs).
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTENSIONS = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const CACHE_SECONDS = 5 * 60;

function buildFaviconHandler({ settingsModel, uploadsDir, fsImpl = fs } = {}) {
  if (!settingsModel || typeof settingsModel.read !== 'function') {
    throw new Error('buildFaviconHandler requires a settingsModel with .read()');
  }
  if (!uploadsDir) throw new Error('buildFaviconHandler requires an uploadsDir');
  const uploadsAbs = path.resolve(uploadsDir);

  return function dynamicFavicon(req, res, next) {
    let row;
    try { row = settingsModel.read(); } catch (_) { row = null; }
    const logoPath = row && typeof row.companyLogoPath === 'string' ? row.companyLogoPath.trim() : '';
    if (!logoPath) return next();

    // companyLogoPath is stored as `/uploads/<filename>`. Strip the prefix and any traversal,
    // resolve inside uploadsDir, then enforce containment.
    const basename = path.basename(logoPath);
    if (!basename || basename === '..' || basename === '.') return next();
    const resolved = path.resolve(uploadsAbs, basename);
    if (!resolved.startsWith(uploadsAbs + path.sep) && resolved !== uploadsAbs) return next();

    if (!fsImpl.existsSync(resolved)) return next();

    const ext = path.extname(basename).toLowerCase();
    const mime = SUPPORTED_EXTENSIONS[ext];
    if (!mime) return next();

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
    // sendFile re-checks existence + sets Last-Modified / ETag for free.
    return res.sendFile(resolved, (err) => {
      if (err && !res.headersSent) next(err);
    });
  };
}

module.exports = {
  buildFaviconHandler,
  SUPPORTED_EXTENSIONS,
  CACHE_SECONDS,
};
