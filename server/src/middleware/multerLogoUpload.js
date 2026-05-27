/**
 * Multer middleware for the company-logo upload endpoint.
 *
 * - Disk storage in `server/uploads/`.
 * - Filename normalized to `company-logo.<ext>` (defaults to `.png`).
 * - 2 MB size limit.
 * - Image MIME types only.
 */

const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { isAllowedUpload, allowedExtension } = require('../utils/uploadSafety');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Extension comes from the allowlist, never verbatim from the user's filename.
    const ext = allowedExtension(file.originalname, 'image', '.png');
    cb(null, `company-logo${ext}`);
  },
});

const logoUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!isAllowedUpload(file.originalname, file.mimetype, 'image')) {
      return cb(new Error('Seules les images (PNG, JPG, JPEG, WEBP, GIF) sont acceptées.'));
    }
    cb(null, true);
  },
});

module.exports = logoUpload;
module.exports.uploadsDir = uploadsDir;
