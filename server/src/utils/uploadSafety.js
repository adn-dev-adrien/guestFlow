const path = require('path');

/**
 * Upload safety helpers (pure, unit-tested).
 *
 * - `isAllowedUpload` checks both the extension AND the MIME type against a per-kind allowlist.
 * - `allowedExtension` returns the (whitelisted) extension to store, or a fallback.
 * - `safeUploadName` sanitizes a filename to safe characters.
 * - `safeUploadPath` resolves a name within the uploads dir and rejects path traversal (returns null).
 */

const ALLOWED = {
  image: {
    ext: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
    mime: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  document: {
    ext: ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'],
    mime: [
      'application/pdf',
      'image/png', 'image/jpeg', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv', 'text/plain',
    ],
  },
};

function extOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function isAllowedUpload(originalName, mimetype, kind) {
  const cfg = ALLOWED[kind];
  if (!cfg) return false;
  return cfg.ext.includes(extOf(originalName)) && cfg.mime.includes(String(mimetype || '').toLowerCase());
}

function allowedExtension(originalName, kind, fallback) {
  const cfg = ALLOWED[kind];
  const ext = extOf(originalName);
  return cfg && cfg.ext.includes(ext) ? ext : fallback;
}

function safeUploadName(originalName) {
  const base = path.basename(String(originalName || 'file'));
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'file';
}

function safeUploadPath(uploadsDir, name) {
  const baseDir = path.resolve(uploadsDir);
  const resolved = path.resolve(baseDir, path.basename(String(name || '')));
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) return null;
  return resolved;
}

module.exports = { isAllowedUpload, allowedExtension, safeUploadName, safeUploadPath, ALLOWED };
