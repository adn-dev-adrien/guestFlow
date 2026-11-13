/**
 * The orders the arrival SAS collects, and their changes (specs/guest-app.md rules 71, 87, 88): what a stay ordered in the app before its
 * arrival, ready to render under the SAS step « Commandes Mon séjour », and the amendment of an unpaid one before it is collected. The money
 * and the fiche stay the core's: an order's lines are lines of the stay (`orderRef = order:<id>:<n>`), an edit is the sale service's
 * `removeLine` and a new `sell` of what is kept (`pricing-components.md` rules 13, 25, 27); this file judges what only the plugin knows —
 * the article's bounds, the stock, the order's own snapshot and journal.
 *
 *   dataFor(reservationId)                      → `pluginData['guest-app'].ordersAtArrival` of the SAS, or null (no step: no order, or the
 *                                               arrival complement is collected)
 *   POST /api/guest-app/orders/:id/amend        `{ lines?, removeSessions?, removeOrder? }`
 *                                               → 200 `{ order, ordersAtArrival }`; 409 ORDER_PAID_READ_ONLY / ORDER_NOT_EDITABLE /
 *                                               OUT_OF_STOCK / ITEM_MAX_QUANTITY / the sale's own; 403 outside the reception's day
 */

const sdk = require('../../sdk');
const labels = require('../orderLabels');
const { parisDate } = require('../currentStay');

const { isReceptionOnly } = sdk.coreModule('roles');
const { sasLockReason } = sdk.coreModule('sasEditWindow');
const { roundMoney: round2 } = sdk.coreModule('money');

const ORDER_SALE_SOURCE = 'shop';

const WORDS = Object.freeze({
  paidByCard: 'Payée par carte',
  free: 'Offert',
  dueOnArrival: 'À régler à l’arrivée',
  notEditable: 'Commande non modifiable.',
  paidReadOnly: 'Commande payée par carte : non modifiable ici.',
  invalid: 'Modification invalide.',
  outsideScope: 'Modification impossible hors du jour d’arrivée.',
  outOfStock: (left) => `Plus que ${left} en stock.`,
  maxQuantity: (max, title) => `${max} au plus pour « ${title} ».`,
  offered: 'offerte',
  summary: (count, toCollect, paid) => `${count} commande${count > 1 ? 's' : ''}${toCollect ? ` · ${toCollect} à percevoir` : ''}${paid ? ` · ${paid} payés par carte` : ''}`,
  recapNote: (amount) => `Commandes Mon séjour : ${amount} (dans le complément d’arrivée)`,
});

const fail = (res, status, code, error, extra = {}) => res.status(status).json({ error, code, ...extra });

// One namespace per kind: a resource keyed by its id never meets an option of the same id (audit item 10).
const KEY_PREFIX = Object.freeze({ resource: 'res', breakfast: 'brk' });
const lineKeyOf = (line) => `${KEY_PREFIX[line.kind] || 'opt'}:${Number(line.id)}`;
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function buildArrivalOrdersController({
  db, orders, stays, stayLines, shop, stock, alertStock, sale, now,
}) {
  const standing = (order) => ['confirmed', 'delivered'].includes(order.status);
  // Rule 103 — a 0 € order (the free bath hour) is an unpaid order like any other for the SAS: nothing to settle, editable and removable.
  const unpaid = (order) => ['note', 'none'].includes(order.payment) && standing(order);

  /** The arrival is not reached (rule 104), not marked, and its complement is not collected. */
  const editableStay = (reservationId) => sale().collectionOf(reservationId, now()) === 'arrival'
    && !stays().arrivalMarked(reservationId)
    && stays().arrivalComplementState(reservationId) !== 'collected';

  /** The article's own per-order bound (rules 37, 37quater): `maxQuantity` of what the shop sells, else what the order holds. */
  function boundOf(line, sold) {
    const found = sold.find((s) => s.kind === line.kind && Number(s.row.id) === Number(line.id));
    return found ? Number(found.item.maxQuantity) : Number(line.quantity);
  }

  /** What the stock still allows beside the units the order already holds; Infinity for an article that is not tracked. */
  function stockCapOf(line, stocks) {
    const state = stocks.get(`${line.kind}:${Number(line.id)}`);
    return state ? Number(line.quantity) + Math.max(0, Number(state.left) || 0) : Infinity;
  }

  const maxQuantityOf = (line, sold, stocks) => Math.min(boundOf(line, sold), stockCapOf(line, stocks));

  /** The order's snapshot lines that became a line of their own on the fiche, with that line (a breakfast merged into the stay's own has none). */
  function storedLineOf(order, line, stored) {
    if (line.kind === 'breakfast') return null;
    const taken = stored.filter((s) => s.orderId === Number(order.id));
    const wanted = line.kind === 'resource' ? 'resource' : 'option';
    return taken.find((s) => s.kind === wanted && s.articleId === Number(line.id) && !s.claimed) || null;
  }

  /** One row per article (rule 71): the server's words for the quantity, the unit price and the amount. */
  function lineView(order, line, { editable, sold, stocks, stored }) {
    const key = lineKeyOf(line);
    const quantity = line.kind === 'option' ? Number(line.quantity) : 1;
    const free = line.kind === 'resource' && Number(line.total) === 0;
    const detail = line.kind === 'resource'
      ? [labels.unitLabel(line), free ? WORDS.offered : null].filter(Boolean).join(' · ')
      : labels.unitLabel(line);
    const own = storedLineOf(order, line, stored);
    if (own) own.claimed = true;
    const canEdit = editable && Boolean(own);
    return {
      key,
      label: line.title,
      quantity,
      unitLabel: detail,
      amountLabel: labels.priceLabel(line.total),
      editable: canEdit && line.kind === 'option',
      removable: canEdit,
      maxQuantity: canEdit && line.kind === 'option' ? maxQuantityOf(line, sold, stocks) : quantity,
    };
  }

  function orderView(order, { editable, sold, stocks, stored }) {
    const paid = order.payment === 'card';
    const rows = stored.map((s) => ({ ...s, claimed: false }));
    return {
      id: order.id,
      number: order.id,
      deliveryLabel: order.deliverAt ? labels.momentLabel(order.deliverAt) : null,
      statusLabel: paid ? WORDS.paidByCard : (order.payment === 'none' ? WORDS.free : WORDS.dueOnArrival),
      paid,
      editable: editable && unpaid(order),
      totalLabel: labels.priceLabel(order.total),
      lines: order.lines.map((line) => lineView(order, line, { editable: editable && unpaid(order), sold, stocks, stored: rows })),
    };
  }

  /**
   * Rule 71 — the step's payload, or null when there is nothing to show: the stay holds no order taken before its arrival, or its arrival
   * complement is already collected (the SAS never names what was collected). `changed`: the fiche's lines were lowered since the orders
   * (Σ of the unpaid snapshots above what the arrival complement now asks).
   */
  function dataFor(reservationId) {
    const list = orders().atArrivalFor(reservationId);
    if (!list.length) return null;
    if (stays().arrivalComplementState(reservationId) === 'collected') return null;
    const stay = stays().byId(reservationId);
    if (!stay) return null;
    const editable = editableStay(reservationId);
    const { sold } = shop.soldFor({ stay, lodging: { propertyId: stay.propertyId } });
    const stocks = stock().states(now());
    const stored = stayLines().orderLines(reservationId);
    const views = list.map((order) => orderView(order, { editable, sold, stocks, stored }));
    const toCollect = round2(list.filter(unpaid).reduce((sum, o) => sum + Number(o.total), 0));
    const prepaid = round2(list.filter((o) => o.payment === 'card').reduce((sum, o) => sum + Number(o.total), 0));
    const complement = stays().arrivalComplementAmount(reservationId);
    return {
      orders: views,
      summaryLabel: WORDS.summary(views.length, toCollect > 0 ? labels.priceLabel(toCollect) : '', prepaid > 0 ? labels.priceLabel(prepaid) : ''),
      toCollect,
      toCollectLabel: labels.priceLabel(toCollect),
      paid: prepaid,
      paidLabel: prepaid > 0 ? labels.priceLabel(prepaid) : null,
      recapNote: toCollect > 0 ? WORDS.recapNote(labels.priceLabel(toCollect)) : null,
      changed: toCollect - complement >= 0.01,
    };
  }

  /** The request's shape: `{ lines: [{ key, quantity }], removeSessions: [{ resourceId, date, start }], removeOrder }`. */
  function inputError(body) {
    if (!isObject(body) || Object.keys(body).some((k) => !['lines', 'removeSessions', 'removeOrder'].includes(k))) return true;
    if (body.lines !== undefined && (!Array.isArray(body.lines) || body.lines.some((l) => !isObject(l) || typeof l.key !== 'string'
      || !Number.isInteger(l.quantity) || l.quantity < 0))) return true;
    if (body.removeSessions !== undefined && (!Array.isArray(body.removeSessions) || body.removeSessions.some((s) => !isObject(s)
      || !Number.isInteger(s.resourceId) || typeof s.date !== 'string' || typeof s.start !== 'string'))) return true;
    return body.removeOrder !== undefined && body.removeOrder !== true;
  }

  const minutes = (time) => {
    const [h, m] = String(time || '').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const hoursOf = (sessions) => round2((sessions || []).reduce((sum, s) => sum + Math.max(0, minutes(s.end) - minutes(s.start)), 0) / 60);

  /**
   * What each snapshot line becomes, and what the stay is told: `{ plan: [{ line, next, own }], changes }`, or the refusal of a bound or of the
   * stock. A line the request does not name stays as it is.
   */
  function changePlan(order, body, { sold, stocks, stored }) {
    const asked = new Map((body.lines || []).map((l) => [l.key, l.quantity]));
    const changes = [];
    const claimed = stored.map((s) => ({ ...s, claimed: false }));
    const plan = [];
    for (const line of order.lines) {
      const key = lineKeyOf(line);
      const own = storedLineOf(order, line, claimed);
      if (own) own.claimed = true;
      if (body.removeOrder === true || asked.get(key) === 0) {
        changes.push(`${line.title} retiré`);
        plan.push({ line, own, next: null });
        continue;
      }
      if (line.kind === 'option') {
        const quantity = asked.has(key) ? asked.get(key) : Number(line.quantity);
        if (quantity > boundOf(line, sold)) return { bound: { key, max: boundOf(line, sold), title: line.title } };
        if (quantity > stockCapOf(line, stocks)) return { stock: { key, left: Math.max(0, stockCapOf(line, stocks) - Number(line.quantity)) } };
        if (quantity !== Number(line.quantity)) {
          changes.push(`${line.title} ${line.quantity} → ${quantity}`);
          plan.push({ line, own, next: { ...line, quantity } });
          continue;
        }
      }
      if (line.kind === 'resource') {
        const dropped = (body.removeSessions || []).filter((s) => Number(s.resourceId) === Number(line.id));
        const sessions = (line.sessions || []).filter((s) => !dropped.some((d) => d.date === s.date && d.start === s.start));
        if (sessions.length !== (line.sessions || []).length) {
          if (!sessions.length) {
            changes.push(`${line.title} retiré`);
            plan.push({ line, own, next: null });
            continue;
          }
          const count = line.sessions.length - sessions.length;
          changes.push(`${line.title} : ${count} séance${count > 1 ? 's' : ''} retirée${count > 1 ? 's' : ''}`);
          plan.push({ line, own, next: { ...line, sessions } });
          continue;
        }
      }
      plan.push({ line, own, next: line, unchanged: true });
    }
    return { plan, changes };
  }

  function who(req) {
    const user = req.user || {};
    return user.firstName || user.name || user.username || '';
  }

  const requestOf = (line) => (line.kind === 'resource'
    ? { articleRef: `resource:${line.id}`, quantity: hoursOf(line.sessions), sessions: line.sessions.map(({ date, start, end }) => ({ date, start, end })) }
    : { articleRef: `option:${line.id}`, quantity: line.quantity, ...(line.noFreeUnits ? { noFreeUnits: true } : {}) });

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
      if (sasLockReason({
        stay, side: 'arrival', doneAt: row && row.arrivalSasDoneAt, now: now(),
      })) {
        return fail(res, 403, 'FORBIDDEN', WORDS.outsideScope);
      }
    }
    if (order.payment === 'card' || order.status === 'paid') return fail(res, 409, 'ORDER_PAID_READ_ONLY', WORDS.paidReadOnly);
    if (order.collectAt !== 'arrival' || !unpaid(order) || !editableStay(order.reservationId)) return fail(res, 409, 'ORDER_NOT_EDITABLE', WORDS.notEditable);
    const knownKeys = new Set(order.lines.map(lineKeyOf));
    if ((req.body.lines || []).some((l) => !knownKeys.has(l.key))) return fail(res, 400, 'INVALID_INPUT', WORDS.invalid);

    const { sold } = shop.soldFor({ stay, lodging: { propertyId: stay.propertyId } });
    const stocks = stock().states(now());
    const stored = stayLines().orderLines(order.reservationId);
    const changed = changePlan(order, req.body, { sold, stocks, stored });
    if (changed.bound) return fail(res, 409, 'ITEM_MAX_QUANTITY', WORDS.maxQuantity(changed.bound.max, changed.bound.title), { itemKey: changed.bound.key, max: changed.bound.max });
    if (changed.stock) return fail(res, 409, 'OUT_OF_STOCK', WORDS.outOfStock(changed.stock.left), { itemKey: changed.stock.key, left: changed.stock.left });
    // A line that is no line of its own (a breakfast merged into the stay's own) is edited on the fiche, never from here.
    if (changed.plan.some((step) => !step.unchanged && !step.own)) return fail(res, 409, 'ORDER_NOT_EDITABLE', WORDS.notEditable);

    const at = now();
    let written = null;
    let refused = null;
    const REFUSED = Symbol('amend-refused');
    try {
      db().transaction(() => {
        const kept = [];
        let round = 0;
        for (const step of changed.plan) {
          if (step.unchanged) { kept.push(step.line); continue; }
          const removed = sale().removeLine(order.reservationId, step.own.ref, { now: at, actor: who(req) || null });
          if (removed.status !== 200) { refused = removed; throw REFUSED; }
          if (!step.next) continue;
          round += 1;
          const sold2 = sale().sell(order.reservationId, [requestOf(step.next)], {
            source: ORDER_SALE_SOURCE, now: at, orderRef: `order:${order.id}:${100 + stored.length + round}`,
            history: { field: 'guestOrderAmended', label: 'Commande client modifiée', from: null, to: `Commande client #${order.id} : ${step.next.title} remplacé` },
          });
          if (sold2.status !== 200) { refused = sold2; throw REFUSED; }
          const totalCents = sold2.lines.reduce((sum, l) => sum + l.totalCents, 0);
          kept.push({ ...step.next, total: round2(totalCents / 100) });
        }
        const total = round2(kept.reduce((sum, l) => sum + Number(l.total || 0), 0));
        const text = `Commande client #${order.id} modifiée à l’arrivée : ${changed.changes.join(', ') || 'sans changement'}${who(req) ? ` (${who(req)})` : ''}`;
        db().prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)').run(
          order.reservationId, 'update', JSON.stringify([{ field: 'guestOrderAmended', label: 'Commande client modifiée', from: null, to: text }]),
        );
        written = orders().amend(order.id, {
          lines: kept, total, entry: { at: at.toISOString(), by: who(req) || null, changes: changed.changes }, now: at,
        });
        if (!written) throw new Error('guest order not amendable');
      })();
    } catch (err) {
      if (err !== REFUSED) throw err;
    }
    if (refused) {
      const body = refused.body || {};
      if (body.code === 'ORDER_PERSONS_EXCEEDED') return fail(res, 409, body.code, body.error, { key: body.key, left: body.left });
      return fail(res, refused.status || 409, body.code || 'ORDER_NOT_EDITABLE', body.error || WORDS.notEditable);
    }
    alertStock(stock().reconcile(order.reservationId, parisDate(at)));
    const after = shop.soldFor({ stay, lodging: { propertyId: stay.propertyId } });
    return res.json({
      order: orderView(written, {
        editable: editableStay(order.reservationId), sold: after.sold, stocks: stock().states(now()), stored: stayLines().orderLines(order.reservationId),
      }),
      ordersAtArrival: dataFor(order.reservationId),
    });
  }

  return { dataFor, amend };
}

module.exports = { buildArrivalOrdersController };
