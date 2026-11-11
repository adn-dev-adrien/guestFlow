// Calendar notes controller — thin handlers over calendarNotesModel.

const db = require('../database');
const { isOptionalText, positiveId } = require('../utils/bodyText');
const model = require('../models/calendarNotesModel');
const { entryDateMessage } = require('../utils/stayDates');

function list(req, res) {
  res.json(model.listForProperty(req.params.propertyId, { from: req.query.from, to: req.query.to }));
}

// specs/reservations-backend-mvc.md rule 13 (reading of 2026-11-02) — a note is written on a real day
// inside the date window; a note already stored on its day is edited or cleared whatever the day.
function upsert(req, res) {
  const { propertyId, date } = req.params;
  // specs/reservations-backend-mvc.md rule 26 (audit R40-RES-L1) — a note is written on a logement that exists (an unknown or textual id was a
  // foreign-key 500).
  const id = positiveId(propertyId);
  if (!id || !db.prepare('SELECT 1 FROM properties WHERE id = ?').get(id)) return res.status(404).json({ error: 'Logement non trouvé' });
  if (!isOptionalText(req.body && req.body.note)) return res.status(400).json({ error: 'Texte attendu.', code: 'INVALID_FIELD', field: 'note' });
  const refusal = entryDateMessage(date, { stored: model.exists(propertyId, date) ? date : undefined });
  if (refusal) return res.status(400).json({ error: refusal, field: 'date' });
  return res.json(model.upsert(propertyId, date, req.body && req.body.note));
}

function remove(req, res) {
  res.json(model.remove(req.params.propertyId, req.params.date));
}

module.exports = { list, upsert, remove };
