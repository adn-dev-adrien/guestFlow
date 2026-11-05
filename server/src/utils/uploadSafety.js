const path = require('path');

/**
 * Upload safety helpers (pure, unit-tested).
 *
 * - `isAllowedUpload` checks both the extension AND the MIME type against a per-kind allowlist.
 * - `allowedExtension` returns the (whitelisted) extension to store, or a fallback.
 * - `safeUploadName` sanitizes a filename to safe characters, its base cut so the stored name fits the disk.
 * - `bytesMatchImageName` tells whether a buffer's first bytes are the format its name announces (PNG or JPEG).
 * - `safeUploadPath` resolves a name within the uploads dir and rejects path traversal (returns null).
 */

const ALLOWED = {
  // specs/settings.md rule 8 — the devis PDF embeds the logo, and PDFKit reads PNG and JPEG only.
  image: {
    ext: ['.png', '.jpg', '.jpeg'],
    mime: ['image/png', 'image/jpeg'],
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

// specs/settings-input-guards.md rule 60 — a stored name stays under the 255 bytes of a file name, timestamp prefix
// included: the last 200 characters of the base, then the extension.
const NAME_BASE_MAX = 200;
const NAME_EXT_MAX = 10;

function safeUploadName(originalName) {
  const base = path.basename(String(originalName || 'file'));
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!cleaned) return 'file';
  const ext = path.extname(cleaned).slice(0, NAME_EXT_MAX);
  const stem = cleaned.slice(0, cleaned.length - path.extname(cleaned).length);
  return `${stem.slice(-NAME_BASE_MAX)}${ext}` || 'file';
}

const SIGNATURES = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
};
const FORMAT_OF_EXT = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg' };

function bytesMatchImageName(buffer, originalName) {
  const signature = SIGNATURES[FORMAT_OF_EXT[extOf(originalName)]];
  return Boolean(signature && Buffer.isBuffer(buffer) && buffer.length > signature.length
    && buffer.subarray(0, signature.length).equals(signature));
}

function safeUploadPath(uploadsDir, name) {
  const baseDir = path.resolve(uploadsDir);
  const resolved = path.resolve(baseDir, path.basename(String(name || '')));
  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) return null;
  return resolved;
}

module.exports = { isAllowedUpload, allowedExtension, safeUploadName, safeUploadPath, bytesMatchImageName, ALLOWED };
