/**
 * Refund obligations controller — the close action of the « À rembourser » rows (specs/pricing/pricing-components.md §3 rule 75).
 *
 *   PATCH /api/reservations/:id/refund-obligations/:oid   { status: 'settled' | 'cancelled' }
 *
 * `settled`: the money went back (the operator refunded it from the provider's space or by hand); `cancelled`: nothing was owed
 * after all. Only an open row closes (409 otherwise); a basket's link stops claiming a refund, and the stay's history says so. A
 * `lineLowered` row never closes here (409 `OBLIGATION_REFUND_ONLY`, rule 120): a refund on the trop-perçu settles it.
 * Admin-only through the standard role guard, like the refunds.
 */
const obligationsModel = require('../models/refundObligationsModel');
const reservationsModel = require('../models/reservationsModel');
const database = require('../database');

const STATUSES = ['settled', 'cancelled'];

function closeObligation(req, res) {
  const reservationId = Number(req.params.id);
  const obligationId = Number(req.params.oid);
  const status = String((req.body && req.body.status) || '');
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Statut invalide.', code: 'OBLIGATION_INVALID_STATUS' });
  const row = obligationsModel.findById(obligationId);
  if (!row || Number(row.reservationId) !== reservationId) return res.status(404).json({ error: 'Remboursement à faire introuvable.', code: 'OBLIGATION_NOT_FOUND' });
  if (row.status !== 'open') return res.status(409).json({ error: 'Déjà clos.', code: 'OBLIGATION_ALREADY_CLOSED' });
  // Pricing-components rule 120 (loop t9 D9-2) — a lowered paid line's row is the trop-perçu (rule 75, « the same money, one face »): it
  // closes through a refund on the trop-perçu, which stamps its note part (rule 115), or as the excess shrinks. Closed by hand, it would read
  // as never refunded and the trop-perçu would still ask for it.
  if (row.origin === 'lineLowered') {
    return res.status(409).json({ error: 'Se rembourse depuis le trop-perçu.', code: 'OBLIGATION_REFUND_ONLY' });
  }
  const by = 'operator';
  database.transaction(() => {
    obligationsModel.close(obligationId, { status, by });
    if (row.origin === 'basket' && row.paymentLinkId != null) clearBasketFlag(row.paymentLinkId);
    const { formatEuros } = require('../utils/reservationLedger');
    reservationsModel.addHistoryEntry(reservationId, 'update', [{
      field: 'refundOwed',
      label: 'Remboursement à faire',
      from: `${formatEuros(row.amountCents / 100)} à rembourser`,
      to: status === 'settled' ? 'remboursé' : 'rien à rembourser',
    }]);
  }).immediate();
  return res.json({ obligation: obligationsModel.findById(obligationId), open: obligationsModel.openFor(reservationId) });
}

// The link's basket keeps its legacy flag in step with the register: once closed, it claims nothing.
function clearBasketFlag(linkId) {
  const link = database.prepare('SELECT basketJson FROM payment_links WHERE id = ?').get(Number(linkId));
  if (!link || !link.basketJson) return;
  let basket;
  try { basket = JSON.parse(link.basketJson); } catch { return; }
  if (!basket || basket.refundOwed !== true) return;
  const { refundOwed, refundCents, ...rest } = basket; // eslint-disable-line no-unused-vars
  database.prepare('UPDATE payment_links SET basketJson = ? WHERE id = ?').run(JSON.stringify(rest), Number(linkId));
}

module.exports = { closeObligation };
