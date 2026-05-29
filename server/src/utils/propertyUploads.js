// Property uploads plumbing — multer configs + middleware for photos (sharp-optimized) and documents,
// plus file save/remove. Extracted verbatim from routes/properties.js.

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { isAllowedUpload, safeUploadName, safeUploadPath } = require('./uploadSafety');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const DOCUMENT_LIMIT_BYTES = 10 * 1024 * 1024;
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${safeUploadName(file.originalname)}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: DOCUMENT_LIMIT_BYTES },
  fileFilter: (req, file, cb) => {
    if (!isAllowedUpload(file.originalname, file.mimetype, 'document')) {
      cb(new Error('Type de fichier non autorisé.'));
      return;
    }
    cb(null, true);
  },
});

function handleDocumentUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'Fichier trop volumineux (max 10 Mo).'
        : (err.message || 'Type de fichier non autorisé.');
      return res.status(400).json({ error: msg });
    }
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
      cb(new Error(`Format d'image non pris en charge. Formats acceptés: ${SUPPORTED_PHOTO_FORMATS_LABEL}.`));
      return;
    }
    cb(null, true);
  }
});

function handlePhotoUpload(req, res, next) {
  photoUpload.single('photo')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || `Format d'image non pris en charge. Formats acceptés: ${SUPPORTED_PHOTO_FORMATS_LABEL}.` });
    }
    return next();
  });
}

async function saveOptimizedPhoto(file) {
  if (!file) return '';
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}.webp`;
  const outputPath = path.join(uploadsDir, filename);
  await sharp(file.buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toFile(outputPath);
  return `/uploads/${filename}`;
}

function removeUploadedFile(filePath) {
  if (!filePath || !filePath.startsWith('/uploads/')) return;
  const absPath = safeUploadPath(uploadsDir, filePath);
  if (absPath && fs.existsSync(absPath)) fs.unlinkSync(absPath);
}

// Express error middleware for multer upload errors (photo size etc.).
function multerErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Photo trop volumineuse (max 5 Mo)' });
    }
    return res.status(400).json({ error: err.message || 'Erreur upload' });
  }
  if (err && err.message === 'Le fichier photo doit être une image') {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
}

module.exports = {
  uploadsDir,
  handleDocumentUpload,
  handlePhotoUpload,
  saveOptimizedPhoto,
  removeUploadedFile,
  multerErrorHandler,
};
