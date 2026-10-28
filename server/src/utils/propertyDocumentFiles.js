/**
 * Property documents (contracts, house rules...) are private files: they live in `<uploads>/_private`,
 * which the public `/uploads` static route refuses, and are read through the authenticated
 * `GET /api/properties/:id/documents/:docId/file` (audit 2026-10-28, authz L2).
 *
 * `documents.filePath` stores `private/<name>` for those; a row written before the audit still holds
 * `/uploads/<name>` until `moveLegacyDocumentsToPrivate` moves its file at boot.
 */
const fs = require('fs');
const path = require('path');
const instancePaths = require('./instancePaths');
const { safeUploadPath } = require('./uploadSafety');

const PRIVATE_DIRNAME = '_private';
const PRIVATE_PREFIX = 'private/';

const privateDir = () => path.join(instancePaths.uploadsDir(), PRIVATE_DIRNAME);

function ensurePrivateDir() {
  fs.mkdirSync(privateDir(), { recursive: true });
  return privateDir();
}

const downloadUrl = (propertyId, docId) => `/api/properties/${Number(propertyId)}/documents/${Number(docId)}/file`;

function resolveDocumentFile(filePath) {
  const stored = String(filePath || '');
  const abs = stored.startsWith(PRIVATE_PREFIX)
    ? safeUploadPath(privateDir(), stored.slice(PRIVATE_PREFIX.length))
    : safeUploadPath(instancePaths.uploadsDir(), stored);
  return abs && fs.existsSync(abs) ? abs : null;
}

function removeDocumentFile(filePath) {
  const abs = resolveDocumentFile(filePath);
  if (abs) fs.unlinkSync(abs);
}

/** The shape the client reads: the stored path never leaves the server, a download URL takes its place. */
function publicDocument(row) {
  return { ...row, filePath: downloadUrl(row.propertyId, row.id) };
}

function moveLegacyDocumentsToPrivate(db) {
  const rows = db.prepare("SELECT id, filePath FROM documents WHERE filePath LIKE '/uploads/%'").all();
  let moved = 0;
  for (const row of rows) {
    const from = resolveDocumentFile(row.filePath);
    if (!from) continue;
    const name = path.basename(from);
    fs.renameSync(from, path.join(ensurePrivateDir(), name));
    db.prepare('UPDATE documents SET filePath = ? WHERE id = ?').run(`${PRIVATE_PREFIX}${name}`, row.id);
    moved += 1;
  }
  return moved;
}

module.exports = {
  PRIVATE_DIRNAME, PRIVATE_PREFIX, privateDir, ensurePrivateDir, downloadUrl,
  resolveDocumentFile, removeDocumentFile, publicDocument, moveLegacyDocumentsToPrivate,
};
