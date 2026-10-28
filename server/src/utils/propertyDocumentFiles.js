/**
 * Property documents (contracts, house rules...) are private files. They live in `private-documents`,
 * a sibling of the uploads directory, i.e. OUTSIDE the root the public `/uploads` route serves, so no
 * path trick can reach them; they are read through the authenticated
 * `GET /api/properties/:id/documents/:docId/file` (audit 2026-10-28, authz L2).
 *
 * The sibling is taken from the REAL path of the uploads directory: a self-hosted release links
 * `server/uploads` into `data/uploads` (specs/self-update-and-releases.md rule 25b), so the documents
 * land in `data/private-documents` and survive an update.
 *
 * `documents.filePath` stores `private/<name>` for those; a row written before the audit still holds
 * `/uploads/<name>` until `moveLegacyDocumentsToPrivate` moves its file at boot.
 */
const fs = require('fs');
const path = require('path');
const instancePaths = require('./instancePaths');
const { safeUploadPath } = require('./uploadSafety');

const PRIVATE_PREFIX = 'private/';

function privateDir() {
  const uploads = instancePaths.uploadsDir();
  fs.mkdirSync(uploads, { recursive: true });
  return path.join(path.dirname(fs.realpathSync(uploads)), 'private-documents');
}

function ensurePrivateDir() {
  const dir = privateDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const downloadUrl = (propertyId, docId) => `/api/properties/${Number(propertyId)}/documents/${Number(docId)}/file`;

function locate(filePath) {
  const stored = String(filePath || '');
  const abs = stored.startsWith(PRIVATE_PREFIX)
    ? safeUploadPath(privateDir(), stored.slice(PRIVATE_PREFIX.length))
    : safeUploadPath(instancePaths.uploadsDir(), stored);
  return abs && fs.existsSync(abs) ? abs : null;
}

function removeDocumentFile(filePath) {
  const abs = locate(filePath);
  if (abs) fs.unlinkSync(abs);
}

/** The shape the client reads: the stored path never leaves the server, a download URL takes its place. */
function publicDocument(row) {
  return { ...row, filePath: downloadUrl(row.propertyId, row.id) };
}

/** `Contrat.pdf` for a document named « Contrat » stored as a .pdf; a name that already ends so is kept. */
function downloadName(docName, file) {
  const ext = path.extname(file);
  const base = String(docName || 'document');
  return base.toLowerCase().endsWith(ext.toLowerCase()) ? base : `${base}${ext}`;
}

/**
 * Moves the files uploaded before the audit out of the public tree. Crash-safe order: the file is copied
 * under its final name (never over an existing one), the row is updated, then the original is removed; a
 * retry recognises a file already in place. A row whose file is missing is logged and left alone.
 * Not additive after a rollback (specs/self-update-and-releases.md rule 39, accepted exception: the
 * production instance holds no document).
 */
function moveLegacyDocumentsToPrivate(db, log = console) {
  const rows = db.prepare("SELECT id, filePath FROM documents WHERE filePath LIKE '/uploads/%'").all();
  let moved = 0;
  for (const row of rows) {
    const name = path.basename(row.filePath);
    const from = safeUploadPath(instancePaths.uploadsDir(), name);
    const dir = ensurePrivateDir();
    let to = safeUploadPath(dir, name);
    const sourceExists = from && fs.existsSync(from);
    if (!sourceExists && !(to && fs.existsSync(to))) {
      log.warn(`[documents-private] document ${row.id}: file ${name} not found, row left as it is`);
      continue;
    }
    if (sourceExists) {
      if (fs.existsSync(to) && !fs.readFileSync(to).equals(fs.readFileSync(from))) {
        to = path.join(dir, `${row.id}-${name}`);
      }
      if (!fs.existsSync(to)) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    }
    db.prepare('UPDATE documents SET filePath = ? WHERE id = ?').run(`${PRIVATE_PREFIX}${path.basename(to)}`, row.id);
    if (sourceExists) fs.unlinkSync(from);
    moved += 1;
  }
  return moved;
}

module.exports = {
  PRIVATE_PREFIX, privateDir, ensurePrivateDir, downloadUrl, downloadName,
  resolveDocumentFile: locate, removeDocumentFile, publicDocument, moveLegacyDocumentsToPrivate,
};
