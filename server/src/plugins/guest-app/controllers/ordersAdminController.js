/**
 * The staff's side of the guest orders (specs/guest-app.md rules 41bis, 43, 45): the « Commandes clients » page and the
 * planning's « Commande client » cards, both ready to render, and « Marquer livrée ». Admin and reception (the
 * reception prepares and delivers).
 *
 *   GET  /api/guest-app/orders?status=todo|all        rule 45 — by delivery time; « À préparer » by default
 *   POST /api/guest-app/orders/:id/delivered          rule 45 — `{ status: 'delivered' }`
 *   GET  /api/guest-app/planning/order-cards?from&to  rule 43 — the cards of each planning day
 */

const sdk = require('../../sdk');
const labels = require('../orderLabels');

const { checkPlanningRange } = sdk.coreModule('planningDateRange');
const { wallClockToDate } = sdk.coreModule('stayWindow');

const DAY_MS = 24 * 60 * 60 * 1000;
// « Toutes » reads the last month: the page is about what is being prepared, not the archive.
const ALL_SINCE_DAYS = 30;

const PAYMENT_LABELS = Object.freeze({ card: 'Carte', note: 'Sur la note', none: 'Offerte' });
const STAFF_STATUS = Object.freeze({
  awaiting_payment: 'En attente de paiement', confirmed: 'À préparer', paid: 'À préparer', delivered: 'Livrée',
  expired: 'Expirée', abandoned: 'Abandonnée', paid_conflict: 'Payée · à rembourser',
});

const isPickup = (order) => order.fulfilment === 'pickup';
// Rule 41bis — pickup mode only changes the words: « à retirer », and the check reads « Retirée ».
const FULFILMENT_LABELS = Object.freeze({ delivery: 'Livraison au logement', pickup: 'À retirer' });
const doneLabel = (order) => (isPickup(order) ? 'Retirée' : 'Livrée');
const markLabel = (order) => (isPickup(order) ? 'Marquer retirée' : 'Marquer livrée');

const addDays = (ymd, days) => new Date(Date.parse(`${ymd}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

function buildOrdersAdminController({ orders, stays, lodgings, now }) {
  const lodgingNames = new Map();
  const lodgingName = (propertyId) => {
    if (!lodgingNames.has(propertyId)) {
      const lodging = lodgings().get(propertyId);
      lodgingNames.set(propertyId, lodging ? lodging.name : '');
    }
    return lodgingNames.get(propertyId);
  };

  function rowOf(order) {
    const stay = stays().byId(order.reservationId) || {};
    const guest = [stay.clientFirstName, stay.clientLastName].filter(Boolean).join(' ');
    return {
      id: order.id,
      reservationId: order.reservationId,
      lodging: lodgingName(stay.propertyId),
      guest,
      lines: order.lines.map((l) => ({ label: labels.lineLabel(l), total: l.total, totalLabel: labels.priceLabel(l.total) })),
      deliverAt: order.deliverAt,
      deliverLabel: order.deliverAt ? `${isPickup(order) ? 'À retirer ' : ''}${labels.momentLabel(order.deliverAt)}` : null,
      fulfilment: isPickup(order) ? 'pickup' : 'delivery',
      fulfilmentLabel: FULFILMENT_LABELS[isPickup(order) ? 'pickup' : 'delivery'],
      ...(isPickup(order) && order.pickupPlace ? { pickupPlace: order.pickupPlace } : {}),
      payment: order.payment,
      paymentLabel: PAYMENT_LABELS[order.payment] || order.payment,
      status: order.status,
      statusLabel: order.status === 'delivered' ? doneLabel(order) : (STAFF_STATUS[order.status] || order.status),
      total: order.total,
      totalLabel: labels.priceLabel(order.total),
      canMarkDelivered: ['confirmed', 'paid'].includes(order.status),
      markLabel: markLabel(order),
    };
  }

  function list(req, res) {
    const status = req.query.status === undefined ? 'todo' : req.query.status;
    if (!['todo', 'all'].includes(status)) return res.status(400).json({ error: 'Filtre inconnu.' });
    lodgingNames.clear();
    const all = status === 'all';
    const from = all ? new Date(now().getTime() - ALL_SINCE_DAYS * DAY_MS).toISOString() : null;
    return res.json({ orders: orders().listForStaff({ all, from }).map(rowOf) });
  }

  function delivered(req, res) {
    const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
    const order = Number.isInteger(id) ? orders().findById(id) : null;
    if (!order) return res.status(404).json({ error: 'Commande introuvable' });
    if (order.status === 'delivered') return res.json({ status: 'delivered' });
    const moved = orders().markDelivered(id, { now: now(), userId: req.user && req.user.id });
    if (!moved) return res.status(409).json({ error: 'Cette commande n’est pas à livrer.', code: 'ORDER_NOT_DELIVERABLE' });
    return res.json({ status: 'delivered' });
  }

  /**
   * Rule 43 — a « Commande client » card on the planning day of `deliverAt`, with what the staff prepares: the
   * breakfast has its own card (rule 27bis) and the bath its sessions on the resource planning (rule 30), so an
   * order holding nothing else has no card.
   */
  function planningCards(req, res) {
    const { from, to } = req.query;
    const refused = checkPlanningRange(from, to);
    if (refused) return res.status(refused.status).json({ error: refused.message, code: refused.error });
    lodgingNames.clear();
    const start = wallClockToDate(from, '00:00').toISOString();
    const end = wallClockToDate(addDays(to, 1), '00:00').toISOString();
    const byDay = new Map();
    orders().deliveriesBetween(start, end).forEach((order) => {
      const prepared = order.lines.filter((l) => l.kind === 'option');
      if (!prepared.length) return;
      const { date, time } = labels.parisMoment(order.deliverAt);
      const stay = stays().byId(order.reservationId) || {};
      if (!byDay.has(date)) byDay.set(date, []);
      byDay.get(date).push({
        orderId: order.id,
        reservationId: order.reservationId,
        time,
        timeLabel: `${isPickup(order) ? 'À retirer ' : ''}${labels.timeLabel(time)}`,
        lodging: lodgingName(stay.propertyId),
        guest: [stay.clientFirstName, stay.clientLastName].filter(Boolean).join(' '),
        lines: prepared.map((l) => labels.lineLabel(l)),
        paymentLabel: PAYMENT_LABELS[order.payment] || order.payment,
        delivered: order.status === 'delivered',
        fulfilment: isPickup(order) ? 'pickup' : 'delivery',
        doneLabel: doneLabel(order),
      });
    });
    return res.json({ days: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, cards]) => ({ date, cards })) });
  }

  return { list, delivered, planningCards };
}

module.exports = { buildOrdersAdminController };
