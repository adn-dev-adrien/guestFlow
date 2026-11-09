/**
 * Split payments recorded after the fact (specs/mixed-method-payments.md §3.5-§3.6, §4.3).
 *
 *   POST /api/reservations/:id/settlements              { targetKind, targetKey, date, tenders, shortfall? } — rule 17
 *   PUT  /api/reservations/:id/settlements/:settlementId { date, tenders, shortfall? }                       — rules 20-25
 *
 * Thin: the rules live in utils/paymentSettlementService. The answer is the fiche's fresh row, the client
 * reloads its finance like after any other payment.
 */

const service = require('../utils/paymentSettlementService');

const text = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '');

function reply(res, reservationId, outcome) {
  if (!outcome.ok) return res.status(outcome.status).json({ error: outcome.error, ...(outcome.field ? { field: outcome.field } : {}) });
  return res.json({ ok: true, reservation: service.getRow(reservationId) });
}

function collectRemainder(req, res) {
  const id = Number(req.params.id);
  if (!service.getRow(id)) return res.status(404).json({ error: 'Réservation non trouvée' });
  const body = req.body || {};
  return reply(res, id, service.collectRemainder({
    reservationId: id,
    targetKind: text(body.targetKind),
    targetKey: text(body.targetKey),
    date: body.date,
    tenders: body.tenders,
    shortfall: body.shortfall,
  }));
}

function modify(req, res) {
  const id = Number(req.params.id);
  if (!service.getRow(id)) return res.status(404).json({ error: 'Réservation non trouvée' });
  const body = req.body || {};
  return reply(res, id, service.modify({
    reservationId: id,
    settlementId: Number(req.params.settlementId),
    date: body.date,
    tenders: body.tenders,
    shortfall: body.shortfall,
  }));
}

module.exports = { collectRemainder, modify };
