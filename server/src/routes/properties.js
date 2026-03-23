const router = require('express').Router();
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
router.post('/', upload.single('photo'), (req, res) => {
  const { name, maxAdults, maxChildren, maxBabies, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, cleaningHours } = req.body;
  const photo = req.file ? `/uploads/${req.file.filename}` : '';
  const result = db.prepare(`
    INSERT INTO properties (name, photo, maxAdults, maxChildren, maxBabies, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, cleaningHours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, photo, maxAdults || 2, maxChildren || 0, maxBabies || 0, depositPercent || 30, depositDaysBefore || 30, balanceDaysBefore || 7, defaultCheckIn || '15:00', defaultCheckOut || '10:00', cleaningHours || 3);
  res.json({ id: result.lastInsertRowid });
});

// Update property
router.put('/:id', upload.single('photo'), (req, res) => {
  const { name, maxAdults, maxChildren, maxBabies, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, cleaningHours } = req.body;
  const existing = db.prepare('SELECT photo FROM properties WHERE id = ?').get(req.params.id);
  const photo = req.file ? `/uploads/${req.file.filename}` : (req.body.photo || (existing ? existing.photo : ''));
  db.prepare(`
    UPDATE properties SET name=?, photo=?, maxAdults=?, maxChildren=?, maxBabies=?, depositPercent=?, depositDaysBefore=?, balanceDaysBefore=?, defaultCheckIn=?, defaultCheckOut=?, cleaningHours=?, updatedAt=datetime('now')
    WHERE id=?
  `).run(name, photo, maxAdults || 2, maxChildren || 0, maxBabies || 0, depositPercent || 30, depositDaysBefore || 30, balanceDaysBefore || 7, defaultCheckIn || '15:00', defaultCheckOut || '10:00', cleaningHours || 3, req.params.id);
  res.json({ ok: true });
});

// Delete property
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Pricing Rules ---
router.post('/:id/pricing', (req, res) => {
  const { label, pricePerNight, startDate, endDate, minNights } = req.body;
  const result = db.prepare(`
    INSERT INTO pricing_rules (propertyId, label, pricePerNight, startDate, endDate, minNights)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, label || 'Standard', pricePerNight, startDate || null, endDate || null, minNights || 1);
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id/pricing/:ruleId', (req, res) => {
  const { label, pricePerNight, startDate, endDate, minNights } = req.body;
  db.prepare(`
    UPDATE pricing_rules SET label=?, pricePerNight=?, startDate=?, endDate=?, minNights=?
    WHERE id=? AND propertyId=?
  `).run(label, pricePerNight, startDate || null, endDate || null, minNights || 1, req.params.ruleId, req.params.id);
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
  `).run(req.params.id, type || 'other', name || req.file.originalname, filePath);
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

module.exports = router;
