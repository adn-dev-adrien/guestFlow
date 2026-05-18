const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../database');

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `company-logo${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Seules les images sont acceptées.'));
    cb(null, true);
  },
});

function toSettingsPayload(row) {
  return {
    googleCalendarId: String(row.googleCalendarId || '').trim(),
    googleServiceAccountEmail: String(row.googleServiceAccountEmail || '').trim(),
    googleServiceAccountPrivateKey: String(row.googleServiceAccountPrivateKey || ''),
    companyName: String(row.companyName || '').trim(),
    companyAddress: String(row.companyAddress || '').trim(),
    companySiret: String(row.companySiret || '').trim(),
    companyTva: String(row.companyTva || '').trim(),
    companyIban: String(row.companyIban || '').trim(),
    companyBic: String(row.companyBic || '').trim(),
    companyBankName: String(row.companyBankName || '').trim(),
    quoteFooterText: String(row.quoteFooterText || ''),
    quoteValidityDays: Number(row.quoteValidityDays ?? 30),
    companyLogoPath: row.companyLogoPath || '',
    updatedAt: row.updatedAt || null,
  };
}

router.get('/', (req, res) => {
  const settings = db.getAppSettings();
  return res.json(toSettingsPayload(settings));
});

router.put('/', (req, res) => {
  const payload = {
    googleCalendarId: String(req.body.googleCalendarId || '').trim(),
    googleServiceAccountEmail: String(req.body.googleServiceAccountEmail || '').trim(),
    googleServiceAccountPrivateKey: String(req.body.googleServiceAccountPrivateKey || ''),
    companyName: String(req.body.companyName || '').trim(),
    companyAddress: String(req.body.companyAddress || '').trim(),
    companySiret: String(req.body.companySiret || '').trim(),
    companyTva: String(req.body.companyTva || '').trim(),
    companyIban: String(req.body.companyIban || '').trim(),
    companyBic: String(req.body.companyBic || '').trim(),
    companyBankName: String(req.body.companyBankName || '').trim(),
    quoteFooterText: String(req.body.quoteFooterText || ''),
    quoteValidityDays: Number(req.body.quoteValidityDays) || 30,
  };

  db.upsertAppSettings(payload);
  const settings = db.getAppSettings();
  return res.json(toSettingsPayload(settings));
});

// POST /api/settings/logo — upload company logo
router.post('/logo', (req, res) => {
  logoUpload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Erreur upload logo.' });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni.' });
    const logoPath = `/uploads/${req.file.filename}`;
    db.upsertAppSettings({ ...db.getAppSettings(), companyLogoPath: logoPath });
    return res.json({ companyLogoPath: logoPath });
  });
});

// DELETE /api/settings/logo — remove company logo
router.delete('/logo', (req, res) => {
  const settings = db.getAppSettings();
  if (settings.companyLogoPath) {
    const absPath = path.join(uploadsDir, path.basename(settings.companyLogoPath));
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  }
  db.upsertAppSettings({ ...settings, companyLogoPath: '' });
  return res.json({ companyLogoPath: '' });
});

module.exports = router;
