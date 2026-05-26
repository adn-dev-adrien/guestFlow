/**
 * Establishment closures controller — orchestrates list / create / update / delete
 * with range validation, property existence check, and overlap detection.
 */

const db = require('../database');
const model = require('../models/establishmentClosuresModel');
const { validateRange } = require('../utils/establishmentClosuresValidation');
const { sentenceCase } = require('../utils/textFormatters');

function normalizePropertyId(raw) {
  if (raw == null || raw === '' || raw === 'null') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function propertyExists(id) {
  if (id == null) return true;
  const row = db.prepare('SELECT id FROM properties WHERE id = ?').get(id);
  return Boolean(row);
}

function buildReservationOverlapMessage(row) {
  return `Une réservation existe déjà sur cette période (${row.propertyName}, du ${row.startDate} au ${row.endDate}).`;
}

function list(req, res) {
  const params = {};
  const propertyId = normalizePropertyId(req.query.propertyId);
  if (propertyId != null) params.propertyId = propertyId;
  if (req.query.from) params.from = String(req.query.from);
  if (req.query.to) params.to = String(req.query.to);
  return res.json(model.list(params));
}

function create(req, res) {
  const propertyId = normalizePropertyId(req.body && req.body.propertyId);
  const startDate = req.body && req.body.startDate ? String(req.body.startDate) : '';
  const endDate = req.body && req.body.endDate ? String(req.body.endDate) : '';
  const rawLabel = req.body && req.body.label ? String(req.body.label) : '';

  const rangeError = validateRange(startDate, endDate);
  if (rangeError) return res.status(400).json({ error: rangeError, code: 'INVALID_RANGE' });

  if (!propertyExists(propertyId)) {
    return res.status(400).json({ error: 'Logement introuvable.', code: 'INVALID_PROPERTY' });
  }

  const reservationOverlap = model.findReservationOverlap(propertyId, startDate, endDate);
  if (reservationOverlap) {
    return res.status(409).json({
      error: buildReservationOverlapMessage(reservationOverlap),
      code: 'RESERVATION_OVERLAP',
    });
  }

  const closureOverlap = model.findClosureOverlap(propertyId, startDate, endDate);
  if (closureOverlap) {
    return res.status(409).json({
      error: 'Cette période chevauche déjà une fermeture existante.',
      code: 'CLOSURE_OVERLAP',
    });
  }

  const label = sentenceCase(rawLabel || 'Fermeture établissement') || 'Fermeture établissement';
  const result = model.insert({ propertyId, label, startDate, endDate });
  return res.json({ id: result.id });
}

function update(req, res) {
  const id = Number(req.params.id);
  const existing = model.findById(id);
  if (!existing) return res.status(404).json({ error: 'Période de fermeture introuvable.' });

  const propertyId = normalizePropertyId(req.body && req.body.propertyId);
  const startDate = req.body && req.body.startDate ? String(req.body.startDate) : '';
  const endDate = req.body && req.body.endDate ? String(req.body.endDate) : '';
  const rawLabel = req.body && req.body.label ? String(req.body.label) : '';

  const rangeError = validateRange(startDate, endDate);
  if (rangeError) return res.status(400).json({ error: rangeError, code: 'INVALID_RANGE' });

  if (!propertyExists(propertyId)) {
    return res.status(400).json({ error: 'Logement introuvable.', code: 'INVALID_PROPERTY' });
  }

  const reservationOverlap = model.findReservationOverlap(propertyId, startDate, endDate);
  if (reservationOverlap) {
    return res.status(409).json({
      error: buildReservationOverlapMessage(reservationOverlap),
      code: 'RESERVATION_OVERLAP',
    });
  }

  const closureOverlap = model.findClosureOverlap(propertyId, startDate, endDate, id);
  if (closureOverlap) {
    return res.status(409).json({
      error: 'Cette période chevauche déjà une fermeture existante.',
      code: 'CLOSURE_OVERLAP',
    });
  }

  const label = sentenceCase(rawLabel || 'Fermeture établissement') || 'Fermeture établissement';
  model.update(id, { propertyId, label, startDate, endDate });
  return res.json({ ok: true });
}

function remove(req, res) {
  const id = Number(req.params.id);
  model.delete(id);
  return res.json({ ok: true });
}

module.exports = { list, create, update, delete: remove };
