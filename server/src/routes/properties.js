const router = require('express').Router();
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { sentenceCase } = require('../utils/textFormatters');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});
const upload = multer({ storage });

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      cb(new Error('Le fichier photo doit être une image'));
      return;
    }
    cb(null, true);
  }
});

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
  const absPath = path.join(uploadsDir, path.basename(filePath));
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
}

// List all properties
router.get('/', (req, res) => {
  const properties = db.prepare('SELECT * FROM properties ORDER BY name').all();
  res.json(properties);
});

// Get single property with pricing rules, documents, and available options
router.get('/:id', (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Logement non trouvé' });

  property.pricingRules = db.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(req.params.id);
  property.documents = db.prepare('SELECT * FROM documents WHERE propertyId = ?').all(req.params.id);
  property.optionIds = db.prepare('SELECT optionId FROM property_options WHERE propertyId = ?').all(req.params.id).map(r => r.optionId);
  res.json(property);
});

// Create property
router.post('/', photoUpload.single('photo'), async (req, res) => {
  try {
    const { name, maxAdults, maxChildren, maxBabies, singleBeds, doubleBeds, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, cleaningHours, defaultCautionAmount, touristTaxPerDayPerPerson } = req.body;
    const photo = req.file ? await saveOptimizedPhoto(req.file) : '';
    const result = db.prepare(`
      INSERT INTO properties (name, photo, maxAdults, maxChildren, maxBabies, singleBeds, doubleBeds, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, cleaningHours, defaultCautionAmount, touristTaxPerDayPerPerson)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sentenceCase(name), photo, maxAdults || 2, maxChildren || 0, maxBabies || 0, singleBeds ?? 0, doubleBeds ?? 0, depositPercent || 30, depositDaysBefore || 30, balanceDaysBefore || 7, defaultCheckIn || '15:00', defaultCheckOut || '10:00', cleaningHours || 3, defaultCautionAmount ?? 500, touristTaxPerDayPerPerson ?? 0);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la création du logement' });
  }
});

// Update property
router.put('/:id', photoUpload.single('photo'), async (req, res) => {
  try {
    const { name, maxAdults, maxChildren, maxBabies, singleBeds, doubleBeds, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, cleaningHours, defaultCautionAmount, touristTaxPerDayPerPerson } = req.body;
    const existing = db.prepare('SELECT photo FROM properties WHERE id = ?').get(req.params.id);
    const newPhoto = req.file ? await saveOptimizedPhoto(req.file) : '';
    const photo = newPhoto || (req.body.photo || (existing ? existing.photo : ''));

    db.prepare(`
      UPDATE properties SET name=?, photo=?, maxAdults=?, maxChildren=?, maxBabies=?, singleBeds=?, doubleBeds=?, depositPercent=?, depositDaysBefore=?, balanceDaysBefore=?, defaultCheckIn=?, defaultCheckOut=?, cleaningHours=?, defaultCautionAmount=?, touristTaxPerDayPerPerson=?, updatedAt=datetime('now')
      WHERE id=?
    `).run(sentenceCase(name), photo, maxAdults || 2, maxChildren || 0, maxBabies || 0, singleBeds ?? 0, doubleBeds ?? 0, depositPercent || 30, depositDaysBefore || 30, balanceDaysBefore || 7, defaultCheckIn || '15:00', defaultCheckOut || '10:00', cleaningHours || 3, defaultCautionAmount ?? 500, touristTaxPerDayPerPerson ?? 0, req.params.id);

    if (newPhoto && existing && existing.photo && existing.photo !== newPhoto) {
      removeUploadedFile(existing.photo);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la mise à jour du logement' });
  }
});

// Delete property
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT photo FROM properties WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id);
  if (existing && existing.photo) removeUploadedFile(existing.photo);
  res.json({ ok: true });
});

// --- Pricing Rules ---
router.post('/:id/pricing', (req, res) => {
  const { label, pricePerNight, startDate, endDate, minNights } = req.body;
  const result = db.prepare(`
    INSERT INTO pricing_rules (propertyId, label, pricePerNight, startDate, endDate, minNights)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, sentenceCase(label || 'Standard'), pricePerNight, startDate || null, endDate || null, minNights || 1);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id/pricing/:ruleId', (req, res) => {
  const { label, pricePerNight, startDate, endDate, minNights } = req.body;
  db.prepare(`
    UPDATE pricing_rules SET label=?, pricePerNight=?, startDate=?, endDate=?, minNights=?
    WHERE id=? AND propertyId=?
  `).run(sentenceCase(label), pricePerNight, startDate || null, endDate || null, minNights || 1, req.params.ruleId, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/pricing/:ruleId', (req, res) => {
  db.prepare('DELETE FROM pricing_rules WHERE id = ? AND propertyId = ?').run(req.params.ruleId, req.params.id);
  res.json({ ok: true });
});

// --- Documents ---
router.post('/:id/documents', upload.single('file'), (req, res) => {
  const { type, name } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
  const filePath = `/uploads/${req.file.filename}`;
  const result = db.prepare(`
    INSERT INTO documents (propertyId, type, name, filePath) VALUES (?, ?, ?, ?)
  `).run(req.params.id, type || 'other', sentenceCase(name || req.file.originalname), filePath);
  res.json({ id: result.lastInsertRowid, filePath });
});

router.delete('/:id/documents/:docId', (req, res) => {
  db.prepare('DELETE FROM documents WHERE id = ? AND propertyId = ?').run(req.params.docId, req.params.id);
  res.json({ ok: true });
});

// --- Property options linkage ---
router.put('/:id/options', (req, res) => {
  const { optionIds } = req.body; // array of option ids
  const deleteAll = db.prepare('DELETE FROM property_options WHERE propertyId = ?');
  const insert = db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)');
  const transaction = db.transaction(() => {
    deleteAll.run(req.params.id);
    for (const oid of (optionIds || [])) {
      insert.run(req.params.id, oid);
    }
  });
  transaction();
  res.json({ ok: true });
});

router.use((err, req, res, next) => {
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
});

module.exports = router;
