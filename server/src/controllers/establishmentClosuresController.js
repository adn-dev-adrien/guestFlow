/**
 * Establishment closures controller — orchestrates list / create / update / delete
 * with range validation, property existence check, and overlap detection.
 *
 * Order of the refusals (specs/payment-link-lifecycle.md rule 41): INVALID_RANGE, INVALID_PROPERTY,
 * RESERVATION_OVERLAP, OPEN_PAYMENT_REQUEST, CLOSURE_OVERLAP. `conflicts` answers the same checks,
 * read-only, so the dialog warns before Save.
 *
 * `buildController({ database, model })` lets a test drive it on an in-memory schema.
 */

const { validateRange } = require('../utils/establishmentClosuresValidation');
const { sentenceCase } = require('../utils/textFormatters');
const { emitPricingChanged } = require('../utils/pricingChanged');
const { closureConflicts, MESSAGES } = require('../utils/closureConflicts');

function normalizePropertyId(raw) {
  if (raw == null || raw === '' || raw === 'null') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function buildController({ database, model, onPricingChanged = emitPricingChanged }) {
  function propertyExists(id) {
    if (id == null) return true;
    return Boolean(database.prepare('SELECT id FROM properties WHERE id = ?').get(id));
  }

  // The refusal of a write, or null when the closure can be saved.
  function refusalOf({ propertyId, startDate, endDate, excludeId = null }) {
    const rangeError = validateRange(startDate, endDate);
    if (rangeError) return { status: 400, body: { error: rangeError, code: 'INVALID_RANGE' } };
    if (!propertyExists(propertyId)) {
      return { status: 400, body: { error: 'Logement introuvable.', code: 'INVALID_PROPERTY' } };
    }
    const { reservations, requests } = closureConflicts(model, { propertyId, startDate, endDate });
    if (reservations.length > 0) {
      return { status: 409, body: { error: MESSAGES.RESERVATION_OVERLAP, code: 'RESERVATION_OVERLAP', reservations } };
    }
    if (requests.length > 0) {
      return { status: 409, body: { error: MESSAGES.OPEN_PAYMENT_REQUEST, code: 'OPEN_PAYMENT_REQUEST', requests } };
    }
    if (model.findClosureOverlap(propertyId, startDate, endDate, excludeId)) {
      return { status: 409, body: { error: 'Cette période chevauche déjà une fermeture existante.', code: 'CLOSURE_OVERLAP' } };
    }
    return null;
  }

  function readBody(req) {
    const body = req.body || {};
    return {
      propertyId: normalizePropertyId(body.propertyId),
      startDate: body.startDate ? String(body.startDate) : '',
      endDate: body.endDate ? String(body.endDate) : '',
      label: sentenceCase(String(body.label || '') || 'Fermeture établissement') || 'Fermeture établissement',
    };
  }

  function list(req, res) {
    const params = {};
    const propertyId = normalizePropertyId(req.query.propertyId);
    if (propertyId != null) params.propertyId = propertyId;
    if (req.query.from) params.from = String(req.query.from);
    if (req.query.to) params.to = String(req.query.to);
    return res.json(model.list(params));
  }

  // GET /conflicts — what the closure would meet, before Save (rules 41, 49).
  function conflicts(req, res) {
    const propertyId = normalizePropertyId(req.query.propertyId);
    const startDate = req.query.startDate ? String(req.query.startDate) : '';
    const endDate = req.query.endDate ? String(req.query.endDate) : '';
    const rangeError = validateRange(startDate, endDate);
    if (rangeError) return res.status(400).json({ error: rangeError, code: 'INVALID_RANGE' });
    if (!propertyExists(propertyId)) return res.status(400).json({ error: 'Logement introuvable.', code: 'INVALID_PROPERTY' });
    return res.json(closureConflicts(model, { propertyId, startDate, endDate }));
  }

  function create(req, res) {
    const input = readBody(req);
    const refusal = refusalOf(input);
    if (refusal) return res.status(refusal.status).json(refusal.body);
    const result = model.insert(input);
    // specs/google-vacation-rentals-feed.md rule 12 — `null` (every property) for an establishment-wide closure.
    onPricingChanged(input.propertyId, 'closures');
    return res.json({ id: result.id });
  }

  function update(req, res) {
    const id = Number(req.params.id);
    const existing = model.findById(id);
    if (!existing) return res.status(404).json({ error: 'Période de fermeture introuvable.' });
    const input = readBody(req);
    const refusal = refusalOf({ ...input, excludeId: id });
    if (refusal) return res.status(refusal.status).json(refusal.body);
    model.update(id, input);
    // The closure may have moved from one property to another: both are recomputed.
    onPricingChanged(input.propertyId, 'closures');
    if (existing.propertyId !== input.propertyId) onPricingChanged(existing.propertyId, 'closures');
    return res.json({ ok: true });
  }

  function remove(req, res) {
    const id = Number(req.params.id);
    const existing = model.findById(id);
    model.delete(id);
    if (existing) onPricingChanged(existing.propertyId, 'closures');
    return res.json({ ok: true });
  }

  return { list, conflicts, create, update, delete: remove };
}

const defaultController = buildController({
  database: require('../database'),
  model: require('../models/establishmentClosuresModel'),
});

module.exports = { ...defaultController, buildController };
