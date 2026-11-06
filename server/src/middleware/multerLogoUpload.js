/**
 * Multer middleware for the company-logo upload endpoint (specs/settings.md rule 8).
 *
 * - Held in memory: the controller writes `company-logo.<ext>` only once the first bytes are judged, so a
 *   refused file never replaces the stored logo.
 * - 2 MB size limit.
 * - PNG and JPEG only, by name and MIME type here, by first bytes in the controller.
 */

const fs = require('fs');
const multer = require('multer');
const { isAllowedUpload } = require('../utils/uploadSafety');

const uploadsDir = require('../utils/instancePaths').uploadsDir();
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const LOGO_FORMAT_REFUSAL = 'Logo en PNG ou JPEG uniquement.';

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!isAllowedUpload(file.originalname, file.mimetype, 'image')) {
      const refusal = new Error(LOGO_FORMAT_REFUSAL);
      refusal.code = 'LOGO_FORMAT';
      return cb(refusal);
    }
    cb(null, true);
  },
});

module.exports = logoUpload;
module.exports.uploadsDir = uploadsDir;
module.exports.LOGO_FORMAT_REFUSAL = LOGO_FORMAT_REFUSAL;
