const router = require('express').Router();
const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');

// List all school holiday periods
router.get('/', (req, res) => {
  const holidays = db.prepare('SELECT * FROM school_holidays ORDER BY zoneA_start').all();
  res.json(holidays);
});

// Create a school holiday period
router.post('/', (req, res) => {
  const { label, zoneA_start, zoneA_end, zoneB_start, zoneB_end, zoneC_start, zoneC_end } = req.body;
  const result = db.prepare(
    'INSERT INTO school_holidays (label, zoneA_start, zoneA_end, zoneB_start, zoneB_end, zoneC_start, zoneC_end) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(sentenceCase(label), zoneA_start || null, zoneA_end || null, zoneB_start || null, zoneB_end || null, zoneC_start || null, zoneC_end || null);
  res.json({ id: result.lastInsertRowid });
});

// Update a school holiday period
router.put('/:id', (req, res) => {
  const { label, zoneA_start, zoneA_end, zoneB_start, zoneB_end, zoneC_start, zoneC_end } = req.body;
  db.prepare(
    'UPDATE school_holidays SET label=?, zoneA_start=?, zoneA_end=?, zoneB_start=?, zoneB_end=?, zoneC_start=?, zoneC_end=? WHERE id=?'
  ).run(sentenceCase(label), zoneA_start || null, zoneA_end || null, zoneB_start || null, zoneB_end || null, zoneC_start || null, zoneC_end || null, req.params.id);
  res.json({ ok: true });
});

// Delete a school holiday period
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM school_holidays WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
