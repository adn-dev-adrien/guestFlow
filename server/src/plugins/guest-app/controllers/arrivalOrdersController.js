/**
 * The orders the arrival SAS collects, and their changes (specs/guest-app.md rules 71, 87, 88): what a stay ordered in the
 * app before its arrival, ready to render under the SAS step « Commandes Mon séjour », and the amendment of an unpaid
 * one (quantity, article, session or morning, the whole order) before it is collected. The money and the fiche stay core
 * (`midStayOrderCommit.amendOrder`); this file judges what only the plugin knows: the article's bounds, the stock, the
 * order's own snapshot and journal.
 *
 *   dataFor(reservationId)                      → `pluginData['guest-app'].ordersAtArrival` of the SAS, or null (no step)
 *   POST /api/guest-app/orders/:id/amend        `{ lines?, removeSessions?, removeMornings?, removeOrder? }`
 *                                               → 200 `{ order, ordersAtArrival }`; 409 ORDER_PAID_READ_ONLY / ORDER_NOT_EDITABLE /
 *                                               OUT_OF_STOCK / ORDER_PERSONS_EXCEEDED / the core's two; 403 outside the reception's day
 */

const sdk = require('../../sdk');
const labels = require('../orderLabels');
const { parisDate } = require('../currentStay');

const { isReceptionOnly } = sdk.coreModule('roles');
const { sasLockReason } = sdk.coreModule('sasEditWindow');

const ORDER_SOURCE = 'guestOrder';
const chargeKey = (orderId, resourceId) => `guest-order:${orderId}:evening:${Number(resourceId)}`;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const WORDS = Object.freeze({
  paidByCard: 'Payée par carte',
  dueOnArrival: 'À régler à l’arrivée',
  notEditable: 'Commande non modifiable.',
  paidReadOnly: 'Commande payée par carte : non modifiable ici.',
  invalid: 'Modification invalide.',
  outsideScope: 'Modification impossible hors du jour d’arrivée.',
  outOfStock: (left) => `Plus que ${left} en stock.`,
});

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra });

const lineKeyOf = (line) => `${line.kind === 'resource' ? 'res' : 'opt'}:${Number(line.id)}`;
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function buildArrivalOrdersController({
  orders, stays, shop, stock, alertStock, commit, scheduler, now,
}) {
  const standing = (order) => ['confirmed', 'delivered'].includes(order.status);
  const unpaid = (order) => order.payment === 'note' && standing(order);

  /** The stay's pre-arrival money is settled, its arrival not marked, its arrival complement not collected. */
  const editableStay = (reservationId) => commit.orderCollection(reservationId) === 'arrival'
    && stays().arrivalComplementState(reservationId) !== 'collected';

  /** The most of an article an unpaid order can hold: the article's own bound, and what the stock still has beside it. */
  function maxQuantityOf(line, sold, stocks) {
    const found = sold.find((s) => s.kind === line.kind && Number(s.row.id) === Number(line.id));
    const bound = found ? Number(found.item.maxQuantity) : Number(line.quantity);
    const state = stocks.get(`${line.kind}:${Number(line.id)}`);
    return state ? Math.min(bound, Number(line.quantity) + Math.max(0, Number(state.left) || 0)) : bound;
  }

  function lineView(line, { editable, sold, stocks }) {
    const key = lineKeyOf(line);
    const quantity = line.kind === 'option' ? Number(line.quantity) : 1;
    return {
      key,
      label: line.kind === 'charge' ? labels.lineLabel(line) : line.title,
      quantity,
      unitLabel: labels.unitLabel(line),
      amountLabel: labels.priceLabel(line.total),
      editable: editable && line.kind === 'option',
      removable: editable && line.kind !== 'charge',
      maxQuantity: editable && line.kind === 'option' ? maxQuantityOf(line, sold, stocks) : quantity,
    };
  }

  function orderView(order, { editable, sold, stocks }) {
    const paid = order.payment === 'card';
    return {
      id: order.id,
      number: order.id,
      deliveryLabel: order.deliverAt ? labels.momentLabel(order.deliverAt) : null,
      statusLabel: paid ? WORDS.paidByCard : WORDS.dueOnArrival,
      paid,
      editable: editable && unpaid(order),
      totalLabel: labels.priceLabel(order.total),
      lines: order.lines.map((line) => lineView(line, { editable: editable && unpaid(order), sold, stocks })),
    };
  }

  /** Rule 71 — the step's payload, or null when the stay holds no order taken before its arrival. */
  function dataFor(reservationId) {
    const list = orders().atArrivalFor(reservationId);
    if (!list.length) return null;
    const stay = stays().byId(reservationId);
    if (!stay) return null;
    const editable = editableStay(reservationId);
    const { sold } = shop.soldFor({ stay, lodging: { propertyId: stay.propertyId } });
    const stocks = stock().states(now());
    const views = list.map((order) => orderView(order, { editable, sold, stocks }));
    const toCollect = round2(list.filter(unpaid).reduce((sum, o) => sum + Number(o.total), 0));
    const prepaid = round2(list.filter((o) => o.payment === 'card').reduce((sum, o) => sum + Number(o.total), 0));
    return {
      orders: views,
      toCollect,
      toCollectLabel: labels.priceLabel(toCollect),
      paid: prepaid,
      paidLabel: prepaid > 0 ? labels.priceLabel(prepaid) : null,
      changed: list.some((o) => o.amendmentsJson && o.amendmentsJson !== '[]'),
    };
  }

  /** The request's shape: `{ lines: [{ key, quantity }], removeSessions: [{ resourceId, date, start }], removeMornings: [{ date }], removeOrder }`. */
  function inputError(body) {
    if (!isObject(body) || Object.keys(body).some((k) => !['lines', 'removeSessions', 'removeMornings', 'removeOrder'].includes(k))) return true;
    if (body.lines !== undefined && (!Array.isArray(body.lines) || body.lines.some((l) => !isObject(l) || typeof l.key !== 'string'
      || !Number.isInteger(l.quantity) || l.quantity < 0))) return true;
    if (body.removeSessions !== undefined && (!Array.isArray(body.removeSessions) || body.removeSessions.some((s) => !isObject(s)
      || !Number.isInteger(s.resourceId) || typeof s.date !== 'string' || typeof s.start !== 'string'))) return true;
    if (body.removeMornings !== undefined && (!Array.isArray(body.removeMornings) || body.removeMornings.some((m) => !isObject(m) || typeof m.date !== 'string'))) return true;
    return body.removeOrder !== undefined && body.removeOrder !== true;
  }

  const coreLine = (order, line) => {
    if (line.kind === 'charge') return { kind: 'charge', key: chargeKey(order.id, line.id), label: line.title, amount: line.total };
    if (line.kind === 'breakfast') return { kind: 'breakfast', id: line.id, mornings: line.mornings, time: line.time, persons: line.persons };
    if (line.kind === 'resource' && Array.isArray(line.sessions) && line.sessions.length) {
      return {
        kind: 'resource', id: line.id, sessions: line.sessions.map(({ date, start, end }) => ({ date, start, end })), addedHours: line.addedHours,
      };
    }
    return { kind: line.kind, id: line.id, quantity: line.quantity };
  };

  const minutes = (time) => {
    const [h, m] = String(time || '').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const hoursOf = (sessions) => round2((sessions || []).reduce((sum, s) => sum + Math.max(0, minutes(s.end) - minutes(s.start)), 0) / 60);

  /** The order's new snapshot lines from the request, and the changes said in the stay's history. → `{ lines, changes }` or `{ invalid }`. */
  function changedLines(order, body, { sold, stocks }) {
    const asked = new Map((body.lines || []).map((l) => [l.key, l.quantity]));
    const changes = [];
    const next = [];
    for (const line of order.lines) {
      if (line.kind === 'charge') continue;
      const key = lineKeyOf(line);
      if (body.removeOrder === true || asked.get(key) === 0) {
        changes.push(`${line.title} retiré`);
        continue;
      }
      if (line.kind === 'option') {
        const quantity = asked.has(key) ? asked.get(key) : Number(line.quantity);
        if (quantity > maxQuantityOf(line, sold, stocks)) {
          const left = Math.max(0, maxQuantityOf(line, sold, stocks) - Number(line.quantity));
          return { stock: { key, left } };
        }
        if (quantity !== Number(line.quantity)) {
          changes.push(`${line.title} ${line.quantity} → ${quantity}`);
          const unit = Number(line.quantity) > 0 ? round2(Number(line.total) / Number(line.quantity)) : 0;
          next.push({ ...line, quantity, total: round2(unit * quantity) });
          continue;
        }
        next.push(line);
        continue;
      }
      if (line.kind === 'resource') {
        const dropped = (body.removeSessions || []).filter((s) => Number(s.resourceId) === Number(line.id));
        const sessions = (line.sessions || []).filter((s) => !dropped.some((d) => d.date === s.date && d.start === s.start));
        if (sessions.length !== (line.sessions || []).length) {
          if (!sessions.length) {
            changes.push(`${line.title} retiré`);
            continue;
          }
          const removed = round2(hoursOf(line.sessions) - hoursOf(sessions));
          const addedHours = Math.max(0, round2(Number(line.addedHours || 0) - removed));
          changes.push(`${line.title} : ${line.sessions.length - sessions.length} séance${line.sessions.length - sessions.length > 1 ? 's' : ''} retirée${line.sessions.length - sessions.length > 1 ? 's' : ''}`);
          next.push({ ...line, sessions, addedHours });
          continue;
        }
        next.push(line);
        continue;
      }
      if (line.kind === 'breakfast') {
        const dropped = new Set((body.removeMornings || []).map((m) => m.date));
        const mornings = (line.mornings || []).filter((d) => !dropped.has(d));
        if (mornings.length !== (line.mornings || []).length) {
          if (!mornings.length) {
            changes.push(`${line.title} retiré`);
            continue;
          }
          changes.push(`${line.title} : ${mornings.length} matin${mornings.length > 1 ? 's' : ''}`);
          const unit = (line.mornings || []).length ? Number(line.total) / line.mornings.length : 0;
          next.push({ ...line, mornings, total: round2(unit * mornings.length) });
          continue;
        }
      }
      next.push(line);
    }
    return { lines: next, changes };
  }

  /**
   * The evening charge of each bath line follows its sessions: what the order's line already bills above the day rate (its
   * credit) stays, the evening difference of the sessions left sets the charge (rule 83). Never above what it was.
   */
  function withCharges(order, kept, propertyId) {
    const charges = order.lines.filter((l) => l.kind === 'charge');
    const next = [...kept];
    charges.forEach((charge) => {
      const line = kept.find((l) => l.kind === 'resource' && Number(l.id) === Number(charge.id));
      if (!line) return;
      const before = order.lines.find((l) => l.kind === 'resource' && Number(l.id) === Number(charge.id));
      if (hoursOf(before.sessions) === hoursOf(line.sessions)) {
        next.push(charge);
        return;
      }
      const provider = scheduler();
      const diff = (sessions) => (provider && typeof provider.orderSupplement === 'function'
        ? provider.orderSupplement({ resourceId: line.id, propertyId, sessions, lineGain: { amount: 0, hours: 0 } })
        : 0);
      const credit = Math.max(0, round2(diff(before.sessions) - Number(charge.total)));
      const amount = Math.min(Number(charge.total), Math.max(0, round2(diff(line.sessions) - credit)));
      if (amount > 0) next.push({ ...charge, total: amount });
    });
    return next;
  }

  function who(req) {
    const user = req.user || {};
    return user.firstName || user.name || user.username || '';
  }

  /** `POST /api/guest-app/orders/:id/amend` — rule 87. */
  function amend(req, res) {
    const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
    const order = Number.isInteger(id) ? orders().findById(id) : null;
    if (!order) return fail(res, 404, 'ORDER_NOT_FOUND', 'Commande introuvable.');
    if (inputError(req.body)) return fail(res, 400, 'INVALID_INPUT', WORDS.invalid);
    const stay = stays().byId(order.reservationId);
    if (!stay || stay.kind !== 'reservation') return fail(res, 409, 'ORDER_NOT_EDITABLE', WORDS.notEditable);
    // Rule 87 — the reception only on the arrival day of a SAS not committed yet (reception-sas-today-only.md).
    if (isReceptionOnly(req.user)) {
      const row = stays().arrivalRow(order.reservationId);
      if (sasLockReason({ dateIso: stay.startDate, doneAt: row && row.arrivalSasDoneAt, now: now() })) {
        return fail(res, 403, 'FORBIDDEN', WORDS.outsideScope);
      }
    }
    if (order.payment === 'card' || order.status === 'paid') return fail(res, 409, 'ORDER_PAID_READ_ONLY', WORDS.paidReadOnly);
    if (order.collectAt !== 'arrival' || !unpaid(order) || !editableStay(order.reservationId)) return fail(res, 409, 'ORDER_NOT_EDITABLE', WORDS.notEditable);
    const knownKeys = new Set(order.lines.filter((l) => l.kind !== 'charge').map(lineKeyOf));
    if ((req.body.lines || []).some((l) => !knownKeys.has(l.key))) return fail(res, 400, 'INVALID_INPUT', WORDS.invalid);

    const { sold } = shop.soldFor({ stay, lodging: { propertyId: stay.propertyId } });
    const stocks = stock().states(now());
    const changed = changedLines(order, req.body, { sold, stocks });
    if (changed.stock) {
      return fail(res, 409, 'OUT_OF_STOCK', WORDS.outOfStock(changed.stock.left), { itemKey: changed.stock.key, left: changed.stock.left });
    }
    const kept = withCharges(order, changed.lines, stay.propertyId);
    let written = null;
    const result = commit.amendOrder(order.reservationId, {
      source: ORDER_SOURCE,
      ref: order.id,
      history: {
        field: 'guestOrderAmended',
        label: 'Commande client modifiée',
        text: `Commande client #${order.id} modifiée à l’arrivée : ${changed.changes.join(', ') || 'sans changement'}${who(req) ? ` (${who(req)})` : ''}`,
      },
      from: order.lines.map((l) => coreLine(order, l)),
      to: kept.map((l) => coreLine(order, l)),
      // The fiche's own measure is the truth of what each line now bills: the order's row follows it, or nothing moves.
      within: (outcome) => {
        const lines = kept.map((line) => {
          const before = order.lines.find((l) => l.kind === line.kind && Number(l.id) === Number(line.id));
          const key = line.kind === 'charge' ? `custom:${String(line.title).trim().toLowerCase().replace(/\s+/g, ' ')}` : lineKeyOf(line);
          const unchanged = before && JSON.stringify(before) === JSON.stringify(line);
          return unchanged ? line : { ...line, total: Math.max(0, round2(Number(before ? before.total : line.total) + Number(outcome.byKey[key] || 0))) };
        });
        const total = round2(lines.reduce((sum, l) => sum + Number(l.total || 0), 0));
        written = orders().amend(order.id, {
          lines, total, entry: { at: now().toISOString(), by: who(req) || null, changes: changed.changes }, now: now(),
        });
        if (!written) throw new Error('guest order not amendable');
      },
    });
    if (!result || result.status !== 200) {
      const body = (result && result.body) || {};
      if (body.code === 'ORDER_PERSONS_EXCEEDED') return fail(res, 409, body.code, body.error, { key: body.key, left: body.left });
      return fail(res, (result && result.status) || 409, body.code || 'ORDER_NOT_EDITABLE', body.error || WORDS.notEditable);
    }
    alertStock(stock().reconcile(order.reservationId, parisDate(now())));
    return res.json({ order: orderView(written, { editable: false, sold, stocks }), ordersAtArrival: dataFor(order.reservationId) });
  }

  return { dataFor, amend };
}

module.exports = { buildArrivalOrdersController, chargeKey };
