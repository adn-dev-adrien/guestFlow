const router = require('express').Router();
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { sentenceCase } = require('../utils/textFormatters');
const {
  normalizeDateRanges,
  getBoundsFromDateRanges,
  parseRuleDateRanges,
  normalizeProgressiveTiers,
  buildProgressivePreview,
} = require('../utils/pricing');

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

function findPricingRuleOverlap(propertyId, dateRanges, excludeRuleId = null) {
  if (!dateRanges.length) return null;
  let sql = 'SELECT id, label, startDate, endDate, dateRanges FROM pricing_rules WHERE propertyId = ?';
  const params = [propertyId];
  if (excludeRuleId) {
    sql += ' AND id != ?';
    params.push(excludeRuleId);
  }
  sql += ' ORDER BY startDate';
  const rules = db.prepare(sql).all(...params);

  for (const rule of rules) {
    const existingRanges = parseRuleDateRanges(rule);
    for (const incomingRange of dateRanges) {
      const conflictingRange = existingRanges.find((existingRange) => (
        incomingRange.startDate <= existingRange.endDate && incomingRange.endDate >= existingRange.startDate
      ));
      if (conflictingRange) {
        return {
          id: rule.id,
          label: rule.label,
          startDate: conflictingRange.startDate,
          endDate: conflictingRange.endDate,
        };
      }
    }
  }

  return null;
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

  property.pricingRules = db.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(req.params.id)
    .map((rule) => {
      let tiers = [];
      try {
        tiers = JSON.parse(rule.progressiveTiers || '[]');
      } catch {
        tiers = [];
      }
      return {
        ...rule,
        pricingMode: rule.pricingMode || 'fixed',
        color: rule.color || '#1976d2',
        dateRanges: parseRuleDateRanges(rule),
        progressiveTiers: Array.isArray(tiers) ? tiers : [],
      };
    });
  property.documents = db.prepare('SELECT * FROM documents WHERE propertyId = ?').all(req.params.id);
  property.optionIds = db.prepare('SELECT optionId FROM property_options WHERE propertyId = ?').all(req.params.id).map(r => r.optionId);
  res.json(property);
});

router.post('/:id/pricing/progressive-preview', (req, res) => {
  const { pricePerNight, progressiveTiers, maxNights } = req.body;
  const preview = buildProgressivePreview(Number(pricePerNight || 0), progressiveTiers, Number(maxNights || 14));
  res.json(preview);
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

    const propertyId = result.lastInsertRowid;
    const currentYear = new Date().getFullYear();
    db.prepare(`
      INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      propertyId,
      'Tarif annuel',
      100,
      'fixed',
      '[]',
      JSON.stringify([{ startDate: `${currentYear}-01-01`, endDate: `${currentYear}-12-31` }]),
      '#1976d2',
      `${currentYear}-01-01`,
      `${currentYear}-12-31`,
      1
    );
    res.json({ id: propertyId });
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
  const { label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights } = req.body;
  const normalizedDateRanges = normalizeDateRanges(dateRanges, startDate, endDate);
  const normalizedProgressiveTiers = pricingMode === 'progressive'
    ? normalizeProgressiveTiers(Number(pricePerNight || 0), progressiveTiers)
    : [];
  const conflictingRule = findPricingRuleOverlap(req.params.id, normalizedDateRanges);
  if (conflictingRule) {
    return res.status(400).json({
      error: `Chevauchement avec la saison "${conflictingRule.label}" (${conflictingRule.startDate} au ${conflictingRule.endDate}).`,
      conflictingRule,
    });
  }
  const bounds = getBoundsFromDateRanges(normalizedDateRanges);
  const result = db.prepare(`
    INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id,
    sentenceCase(label || 'Standard'),
    Number(pricePerNight || 0),
    pricingMode || 'fixed',
    JSON.stringify(normalizedProgressiveTiers),
    JSON.stringify(normalizedDateRanges),
    color || '#1976d2',
    bounds.startDate,
    bounds.endDate,
    minNights || 1
  );
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id/pricing/:ruleId', (req, res) => {
  const { label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights } = req.body;
  const normalizedDateRanges = normalizeDateRanges(dateRanges, startDate, endDate);
  const normalizedProgressiveTiers = pricingMode === 'progressive'
    ? normalizeProgressiveTiers(Number(pricePerNight || 0), progressiveTiers)
    : [];
  const conflictingRule = findPricingRuleOverlap(req.params.id, normalizedDateRanges, req.params.ruleId);
  if (conflictingRule) {
    return res.status(400).json({
      error: `Chevauchement avec la saison "${conflictingRule.label}" (${conflictingRule.startDate} au ${conflictingRule.endDate}).`,
      conflictingRule,
    });
  }
  const bounds = getBoundsFromDateRanges(normalizedDateRanges);
  db.prepare(`
    UPDATE pricing_rules SET label=?, pricePerNight=?, pricingMode=?, progressiveTiers=?, dateRanges=?, color=?, startDate=?, endDate=?, minNights=?
    WHERE id=? AND propertyId=?
  `).run(
    sentenceCase(label || 'Standard'),
    Number(pricePerNight || 0),
    pricingMode || 'fixed',
    JSON.stringify(normalizedProgressiveTiers),
    JSON.stringify(normalizedDateRanges),
    color || '#1976d2',
    bounds.startDate,
    bounds.endDate,
    minNights || 1,
    req.params.ruleId,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id/pricing/:ruleId', (req, res) => {
  db.prepare('DELETE FROM pricing_rules WHERE id = ? AND propertyId = ?').run(req.params.ruleId, req.params.id);
  res.json({ ok: true });
});

router.post('/:id/pricing/apply-to', (req, res) => {
  const sourcePropertyId = Number(req.params.id);
  const targetPropertyId = Number(req.body.targetPropertyId);
  const replaceExisting = Boolean(req.body.replaceExisting);

  if (!targetPropertyId) {
    return res.status(400).json({ error: 'Le logement cible est requis.' });
  }
  if (sourcePropertyId === targetPropertyId) {
    return res.status(400).json({ error: 'Le logement source et le logement cible doivent être différents.' });
  }

  const sourceProperty = db.prepare('SELECT id, name FROM properties WHERE id = ?').get(sourcePropertyId);
  if (!sourceProperty) {
    return res.status(404).json({ error: 'Logement source introuvable.' });
  }
  const targetProperty = db.prepare('SELECT id, name FROM properties WHERE id = ?').get(targetPropertyId);
  if (!targetProperty) {
    return res.status(404).json({ error: 'Logement cible introuvable.' });
  }

  const sourceRules = db.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(sourcePropertyId);
  if (!sourceRules.length) {
    return res.status(400).json({ error: 'Aucune saison à appliquer pour le logement source.' });
  }

  const normalizedSourceRules = sourceRules.map((rule) => {
    const normalizedDateRanges = normalizeDateRanges(parseRuleDateRanges(rule), rule.startDate, rule.endDate);
    const bounds = getBoundsFromDateRanges(normalizedDateRanges);
    return {
      label: sentenceCase(rule.label || 'Standard'),
      pricePerNight: Number(rule.pricePerNight || 0),
      pricingMode: rule.pricingMode || 'fixed',
      progressiveTiers: rule.progressiveTiers || '[]',
      dateRanges: JSON.stringify(normalizedDateRanges),
      color: rule.color || '#1976d2',
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      minNights: Number(rule.minNights || 1),
      normalizedDateRanges,
    };
  });

  if (!replaceExisting) {
    for (const sourceRule of normalizedSourceRules) {
      const conflict = findPricingRuleOverlap(targetPropertyId, sourceRule.normalizedDateRanges);
      if (conflict) {
        return res.status(409).json({
          error: `Impossible d'appliquer: chevauchement avec la saison "${conflict.label}" du logement cible (${conflict.startDate} au ${conflict.endDate}).`,
          code: 'PRICING_OVERLAP',
          conflictingRule: conflict,
        });
      }
    }
  }

  const insertRule = db.prepare(`
    INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const applyTransaction = db.transaction(() => {
    if (replaceExisting) {
      db.prepare('DELETE FROM pricing_rules WHERE propertyId = ?').run(targetPropertyId);
    }
    for (const rule of normalizedSourceRules) {
      insertRule.run(
        targetPropertyId,
        rule.label,
        rule.pricePerNight,
        rule.pricingMode,
        rule.progressiveTiers,
        rule.dateRanges,
        rule.color,
        rule.startDate,
        rule.endDate,
        rule.minNights,
      );
    }
  });

  applyTransaction();
  return res.json({ ok: true, copiedRules: normalizedSourceRules.length, replaceExisting });
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
