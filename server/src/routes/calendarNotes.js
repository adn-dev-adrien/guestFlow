const express = require('express');
const router = express.Router();
const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');

const MAX_NOTE_LENGTH = 50;

// GET notes for a property (optionally filtered by month)
router.get('/:propertyId', (req, res) => {
  const { propertyId } = req.params;
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    rows = db.prepare('SELECT * FROM calendar_notes WHERE propertyId = ? AND date >= ? AND date <= ?').all(propertyId, from, to);
  } else {
    rows = db.prepare('SELECT * FROM calendar_notes WHERE propertyId = ?').all(propertyId);
  }
  res.json(rows);
});

// PUT (upsert) a note for a specific date
router.put('/:propertyId/:date', (req, res) => {
  const { propertyId, date } = req.params;
  const note = sentenceCase(req.body.note || '').slice(0, MAX_NOTE_LENGTH);
  if (!note.trim()) {
    // Delete note if empty
    db.prepare('DELETE FROM calendar_notes WHERE propertyId = ? AND date = ?').run(propertyId, date);
    return res.json({ deleted: true });
  }
  db.prepare(`
    INSERT INTO calendar_notes (propertyId, date, note) VALUES (?, ?, ?)
    ON CONFLICT(propertyId, date) DO UPDATE SET note = excluded.note
  `).run(propertyId, date, note.trim());
  const row = db.prepare('SELECT * FROM calendar_notes WHERE propertyId = ? AND date = ?').get(propertyId, date);
  res.json(row);
});

// DELETE a note
router.delete('/:propertyId/:date', (req, res) => {
  const { propertyId, date } = req.params;
  db.prepare('DELETE FROM calendar_notes WHERE propertyId = ? AND date = ?').run(propertyId, date);
  res.json({ deleted: true });
});

module.exports = router;
