// Property uploads plumbing — multer configs + middleware for photos (sharp-optimized) and documents,
// plus file save/remove. Extracted verbatim from routes/properties.js.

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { isAllowedUpload, safeUploadName, safeUploadPath } = require('./uploadSafety');

// Ensure uploads directory exists
const uploadsDir = require('./instancePaths').uploadsDir();
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const DOCUMENT_LIMIT_BYTES = 10 * 1024 * 1024;
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, require('./propertyDocumentFiles').ensurePrivateDir()),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${safeUploadName(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: DOCUMENT_LIMIT_BYTES },
  fileFilter: (req, file, cb) => {
    if (!isAllowedUpload(file.originalname, file.mimetype, 'document')) {
      const refusal = new Error('Type de fichier non autorisé.');
      refusal.code = 'FILE_TYPE_REFUSED';
      cb(refusal);
      return;
    }
    cb(null, true);
  },
});

// specs/settings-input-guards.md rule 60 — the size and type refusals are ours; any other failure (the disk, the
// parser) answers a fixed message, never its own text, which can hold the server's path.
function documentUploadRefusal(err) {
  if (err.code === 'LIMIT_FILE_SIZE') return 'Fichier trop volumineux (max 10 Mo).';
  if (err.code === 'FILE_TYPE_REFUSED') return err.message;
  console.error('[properties.documents] upload', err && err.code);
  return 'Fichier non enregistré.';
}

function handleDocumentUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: documentUploadRefusal(err) });
    return next();
  });
}

const SUPPORTED_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const SUPPORTED_PHOTO_FORMATS_LABEL = 'JPG, JPEG, PNG, WEBP';

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !SUPPORTED_PHOTO_MIME_TYPES.has(file.mimetype)) {
      const refusal = new Error(`Format d'image non pris en charge. Formats acceptés: ${SUPPORTED_PHOTO_FORMATS_LABEL}.`);
      refusal.code = 'FILE_TYPE_REFUSED';
      cb(refusal);
      return;
    }
    cb(null, true);
  }
});

// specs/settings-input-guards.md rule 60, reading of 2026-11-05 (audit R24 verification N2) — the photo's refusals are ours
// too: multer's own English text (« File too large », « Unexpected field ») never reaches the operator.
function photoUploadRefusal(err) {
  if (err.code === 'LIMIT_FILE_SIZE') return 'Photo trop volumineuse (max 5 Mo).';
  if (err.code === 'FILE_TYPE_REFUSED') return err.message;
  console.error('[properties.photo] upload', err && err.code);
  return 'Fichier non enregistré.';
}

function handlePhotoUpload(req, res, next) {
  photoUpload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: photoUploadRefusal(err) });
    return next();
  });
}

// specs/settings-input-guards.md rule 59 — a file the image library cannot read is the operator's photo, not a
// server fault: 400 « Image illisible. », thrown before the model writes anything.
const PHOTO_UNREADABLE = Object.freeze({ status: 400, body: { error: 'Image illisible.', code: 'PHOTO_UNREADABLE' } });

function isUnreadablePhoto(err) {
  return Boolean(err && err.code === PHOTO_UNREADABLE.body.code);
}

async function saveOptimizedPhoto(file) {
  if (!file) return '';
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}.webp`;
  const outputPath = path.join(uploadsDir, filename);
  try {
    await sharp(file.buffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toFile(outputPath);
  } catch (err) {
    fs.rmSync(outputPath, { force: true });
    const refusal = new Error(PHOTO_UNREADABLE.body.error);
    refusal.code = PHOTO_UNREADABLE.body.code;
    throw refusal;
  }
  return `/uploads/${filename}`;
}

function removeUploadedFile(filePath) {
  if (!filePath || !filePath.startsWith('/uploads/')) return;
  const absPath = safeUploadPath(uploadsDir, filePath);
  if (absPath && fs.existsSync(absPath)) fs.unlinkSync(absPath);
}

module.exports = {
  uploadsDir,
  handleDocumentUpload,
  handlePhotoUpload,
  saveOptimizedPhoto,
  isUnreadablePhoto,
  PHOTO_UNREADABLE,
  removeUploadedFile,
};
