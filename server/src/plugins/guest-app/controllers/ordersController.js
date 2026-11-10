/**
 * Orders (specs/guest-app.md rules 25, 29-38quater, 41-44): the quote, the order, its card payment, its follow-up.
 *
 * Every amount is the core engine's (`midStayOrderCommit.priceOrder`, the fiche's own save played without writing):
 * the quote, the order and the line written on the fiche cannot disagree (rule 24). What the plugin judges is what
 * only it knows — what the lodging's shop sells, the 0 € allowance of the stay, the hourly slots read from the
 * resource planning (rule 29), the breakfast mornings and the delivery times of the service hours (rules 27bis, 41).
 *
 *   POST /orders/quote    { lines, deliverAt? }                     → the priced lines, the total
 *   POST /orders          { lines, deliverAt?, payment, returnPath? } → note / 0 €: on the fiche at once; card: a link
 *                         (`Idempotency-Key` header: a replay within the session answers the first order again)
 *   GET  /orders · /orders/:id · POST /orders/:id/abandon
 *
 * `paid(event)` is the order's side of a paid card link (`ctx.paymentBasket`): committed when its slots are still
 * free, else `paid_conflict` and the money flagged for a refund (rules 35-36).
 */

const sdk = require('../../sdk');
const { parisDate } = require('../currentStay');
const { remainingMornings } = require('../sellable');
const { deliveryTimes, ignitionInHours, outsideStay } = require('../serviceHours');
const { languageOf } = require('../language');
const { fail: failGuest, refusal } = require('../refusals');
const { isStaffItem, shopState } = require('./shopController');
const labels = require('../orderLabels');
const { outOfStockOf } = require('../stock');

const publicHttp = sdk.coreModule('publicHttp');
const { isRealIsoDay } = sdk.coreModule('stayDates');
const { toParisIso, wallClockToDate } = sdk.coreModule('stayWindow');
const paymentProviders = sdk.coreModule('paymentProviders');

const MAX_LINES = 20;
const MAX_SESSIONS = 20;
const MAX_MORNINGS = 31;
const HOLD_MS = 30 * 60 * 1000;
// §4.3 — the return page polls its order: the provider is read for one link at most this often.
const REFRESH_MS = 10 * 1000;
// §4.3 — a double tap sends the same key twice: the second answers the first order.
const CLIENT_KEY = /^[A-Za-z0-9._:-]{8,100}$/;
const PRICE_ROSE = Symbol('guest-order-price-rose');
// Rules 34-35, 46 — the guest app's basket source, and the words the fiche's history and ledger use for its orders.
const ORDER_SOURCE = 'guestOrder';
const ORDER_REFUND_LABELS = Object.freeze({ refundOne: 'Commande client à rembourser', refundMany: 'Commandes clients à rembourser' });
const orderNaming = (orderId, { paid = false } = {}) => ({
  source: ORDER_SOURCE,
  ref: Number(orderId),
  history: { field: ORDER_SOURCE, label: 'Commande client', text: `Commande client #${Number(orderId)}${paid ? ' — payée par carte' : ''}` },
});
const KINDS = Object.freeze(['option', 'breakfast', 'resource']);
const PAYMENTS = Object.freeze(['card', 'note', 'none']);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// Rules 30, 80 — a session the picker would not offer: `taken` is `SLOT_TAKEN`, every other reason `SLOT_UNAVAILABLE`.
const SLOT_REASONS = new Set(['taken', 'past', 'heating', 'staff', 'closed', 'duration']);
// Rule 83 — the evening supplement of an app session, written on the fiche as a charge tagged with its order.
const chargeKey = (orderId, resourceId) => `guest-order:${orderId}:evening:${Number(resourceId)}`;

const invalid = (key, params) => refusal(400, 'INVALID_INPUT', key, params);
const limit = (key, params) => refusal(400, 'ORDER_LIMIT', key, params);

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const positiveInt = (v) => Number.isInteger(v) && v > 0;
const keyOf = (line) => `${line.kind === 'resource' ? 'res' : 'opt'}:${Number(line.id)}`;
const isCharge = (line) => Boolean(line) && line.kind === 'charge';

function sessionError(s) {
  if (!isObject(s) || Object.keys(s).some((k) => !['date', 'start', 'end'].includes(k))) return 'invalidSlot';
  if (!isRealIsoDay(s.date) || !HHMM.test(String(s.start)) || !HHMM.test(String(s.end)) || s.start >= s.end) return 'invalidSlot';
  return null;
}

function lineError(line) {
  if (!isObject(line) || !KINDS.includes(line.kind) || !positiveInt(line.id)) return invalid('invalidLine');
  if (line.kind === 'breakfast') {
    if (Object.keys(line).some((k) => !['kind', 'id', 'mornings', 'time', 'persons'].includes(k))) return invalid('invalidLine');
    if (!Array.isArray(line.mornings) || !line.mornings.length || line.mornings.length > MAX_MORNINGS
      || line.mornings.some((d) => !isRealIsoDay(d)) || new Set(line.mornings).size !== line.mornings.length) return invalid('invalidMornings');
    if (!HHMM.test(String(line.time))) return invalid('invalidTime');
    if (!positiveInt(line.persons) || line.persons > 50) return invalid('invalidPersons');
    return null;
  }
  if (Object.keys(line).some((k) => !['kind', 'id', 'quantity', 'sessions'].includes(k))) return invalid('invalidLine');
  if (line.sessions !== undefined) {
    if (line.kind !== 'resource' || !Array.isArray(line.sessions) || !line.sessions.length) return invalid('invalidLine');
    if (line.sessions.length > MAX_SESSIONS) return limit('maxSessions', { max: MAX_SESSIONS });
    const bad = line.sessions.map(sessionError).find(Boolean);
    if (bad) return invalid(bad);
    return line.quantity === undefined ? null : invalid('slotNoQuantity');
  }
  if (!Number.isInteger(line.quantity) || line.quantity < 1) return invalid('invalidQuantity');
  return null;
}

/** The request's shape, judged before anything reads it: a refusal `{ status, code, key, params }` or null. */
function orderInputError(body, { withPayment }) {
  const allowed = withPayment ? ['lines', 'deliverAt', 'payment', 'returnPath'] : ['lines', 'deliverAt'];
  if (!isObject(body) || Object.keys(body).some((k) => !allowed.includes(k))) return invalid('invalidRequest');
  if (!Array.isArray(body.lines) || !body.lines.length) return invalid('emptyCart');
  if (body.lines.length > MAX_LINES) return limit('maxLines', { max: MAX_LINES });
  const bad = body.lines.map(lineError).find(Boolean);
  if (bad) return bad;
  if (new Set(body.lines.map(keyOf)).size !== body.lines.length) return invalid('duplicateLine');
  if (body.deliverAt !== undefined && body.deliverAt !== null
    && (typeof body.deliverAt !== 'string' || body.deliverAt.length > 40 || !Number.isFinite(Date.parse(body.deliverAt)))) return invalid('invalidDeliverAt');
  if (withPayment && !PAYMENTS.includes(body.payment)) return invalid('invalidPayment');
  if (withPayment && body.returnPath !== undefined && (typeof body.returnPath !== 'string' || body.returnPath.length > 200)) return invalid('invalidRequest');
  return null;
}

const minutesOf = (time) => {
  const [h, m] = String(time || '').split(':').map(Number);
  return h * 60 + m;
};
const sessionsHours = (sessions) => sessions.reduce((sum, s) => sum + Math.max(0, minutesOf(s.end) - minutesOf(s.start)), 0) / 60;


function buildOrdersController({
  db, orders, stays, lodgings, shop, scheduler, serviceHours, commit, payments, push, maxOrderTotal, guestHost, now,
  stock, alertStock = () => {}, fulfilment = () => ({ mode: 'delivery', place: null }), translator = null,
}) {
  /**
   * Rule 61 — the article's title in the request's language, as the shop shows it: the quote's labels and the
   * refusals naming it. The order stores the French catalogue title (stay-link notes).
   */
  function shownTitleOf(item, lang) {
    const french = item.row.title || item.row.name;
    const tr = translator ? translator(lang) : null;
    if (!tr) return french;
    const id = Number(item.row.id);
    return (item.kind === 'resource' ? tr.resourceName(id, item.row.name) : tr.optionTitle(id, item.row.title)) || french;
  }

  /** Rule 37ter — the stay's counts brought to date in the commit's own transaction. → the articles that moved. */
  const countStock = (reservationId, at) => stock().reconcile(reservationId, parisDate(at));

  /** Rule 41 — the delivery times of the staff-prepared lines, as instants (ms) from `at`. */
  function deliveryInstants({ stay, lodging, leadMinutes, at }) {
    return deliveryTimes({ now: at, stay, leadMinutes, schedule: shop.scheduleOf(lodging, at) }).map((moment) => moment.at);
  }

  /**
   * Rules 23, 25, 27bis, 29, 31, 41 — each line against what the shop sells now: unavailable lines and sessions are
   * said, never dropped silently; what can be ordered goes to the engine. A thrown `{ status, code }` is a refusal
   * of the request itself (a quantity over `maxQuantity`).
   */
  function judge(guest, body, at, lang) {
    const { stay, lodging } = guest;
    const T = labels.textOf(lang);
    const { sold, extras } = shop.soldFor(guest);
    const party = Math.max(1, Number(stay.adults || 0) + Number(stay.teens || 0) + Number(stay.children || 0));
    const today = parisDate(at);
    const clock = (toParisIso(at) || '').slice(11, 16);
    const canIgnite = ignitionInHours(shop.scheduleOf(lodging, at));
    const stocks = stock().states(at);
    const judged = body.lines.map((asked) => {
      const item = sold.find((s) => s.kind === asked.kind && Number(s.row.id) === Number(asked.id));
      const base = {
        kind: asked.kind, id: Number(asked.id), title: item ? (item.row.title || item.row.name) : null, shownTitle: item ? shownTitleOf(item, lang) : null,
      };
      if (!item) return { ...base, asked, unavailable: true, unavailableReason: T.unavailable };
      if (item.alreadyIncluded) return { ...base, asked, item, unavailable: true, unavailableReason: T.alreadyIncluded };
      const maxQuantity = Number(item.item.maxQuantity);
      if (asked.kind === 'breakfast') {
        if (asked.persons > party) throw invalid('personsOverParty');
        const possible = new Set(remainingMornings({
          startDate: stay.startDate, endDate: stay.endDate, today, time: clock, serviceTime: item.row.breakfastTime,
        }));
        const times = Number(item.item.needsStaff) === 1
          ? new Set(deliveryInstants({ stay, lodging, leadMinutes: item.item.leadMinutes, at }))
          : null;
        const fits = (date) => possible.has(date) && (!times || times.has(wallClockToDate(date, asked.time).getTime()));
        const mornings = asked.mornings.slice().sort();
        const off = mornings.filter((d) => !fits(d));
        return {
          ...base, asked, item, mornings: mornings.filter(fits), time: asked.time, persons: asked.persons,
          ...(off.length ? { unavailableMornings: off.map((date) => ({ date, reason: T.morningUnavailable })) } : {}),
          ...(off.length === mornings.length ? { unavailable: true, unavailableReason: T.morningUnavailable } : {}),
        };
      }
      if (item.hourly) {
        if (!asked.sessions) throw invalid('chooseSlot');
        const verdict = scheduler() && scheduler().validateSessions({
          resourceId: Number(asked.id), propertyId: lodging.propertyId, stay, sessions: asked.sessions, now: at, heatFrom: at, canIgnite,
        });
        if (!verdict) return { ...base, asked, item, unavailable: true, unavailableReason: T.unavailable };
        const sessions = verdict.results.map((r) => ({
          date: r.date, start: r.start, end: r.end, ...(r.ok ? {} : { unavailable: true, reason: r.reason, reasonLabel: T.slot[r.reason] || T.unavailable }),
        }));
        const kept = sessions.filter((s) => !s.unavailable).map(({ date, start, end }) => ({ date, start, end }));
        const hours = sessionsHours(kept);
        if (item.included && hours > Number(item.includedLeft || 0)) return { ...base, asked, item, sessions, unavailable: true, unavailableReason: T.allowanceUsed };
        return {
          ...base, asked, item, sessions, kept, heldHours: shop.includedHoursLeft(extras, asked.id), ...(kept.length ? {} : { unavailable: true, unavailableReason: sessions[0].reasonLabel }),
        };
      }
      if (asked.sessions) throw invalid('notOnSlot');
      if (asked.quantity > maxQuantity) throw limit('maxQuantity', { max: maxQuantity, title: base.shownTitle });
      if (item.included && asked.quantity > Number(item.includedLeft || 0)) return { ...base, asked, item, quantity: asked.quantity, unavailable: true, unavailableReason: T.allowanceUsed };
      // Rule 37quater — never beyond what is left of a tracked article; the cart lowers the line to it.
      const stockState = stocks.get(`${asked.kind}:${Number(asked.id)}`);
      if (stockState && (stockState.out || asked.quantity > stockState.left)) {
        const outOfStock = outOfStockOf(stockState, lang);
        return {
          ...base, asked, item, quantity: asked.quantity, unavailable: true, unavailableReason: outOfStock.label, outOfStock,
        };
      }
      return { ...base, asked, item, quantity: asked.quantity };
    });
    const staff = judged.filter((l) => l.item && !l.unavailable && isStaffItem(l.item));
    const leadMinutes = staff.length ? Math.max(...staff.map((l) => Number(l.item.item.leadMinutes) || 0)) : 0;
    const needsDelivery = staff.length > 0;
    let deliverAt = null;
    let deliverAtValid = true;
    if (needsDelivery && body.deliverAt) {
      const ms = Date.parse(body.deliverAt);
      deliverAtValid = deliveryInstants({ stay, lodging, leadMinutes, at }).includes(ms);
      if (deliverAtValid) deliverAt = new Date(ms).toISOString();
    }
    return { lines: judged, needsDelivery, leadMinutes, deliverAt, deliverAtValid };
  }

  /** The lines the engine prices and the fiche receives: the available part of each judged line. */
  const commitLines = (judged) => judged.filter((l) => !l.unavailable).map((l) => {
    if (l.kind === 'breakfast') return { kind: 'breakfast', id: l.id, mornings: l.mornings, time: l.time, persons: l.persons };
    if (l.kept) return { kind: 'resource', id: l.id, sessions: l.kept };
    return { kind: l.kind, id: l.id, quantity: l.quantity };
  });

  /**
   * A core refusal of the fiche's save, in the words of the guest app. Persons beyond what the stay can still be
   * served (rule 55) name the article and what is left of it.
   */
  function engineRefusal(result, judged = null) {
    const body = result.body || {};
    const code = body.code;
    if (code === 'MID_STAY_EXTRAS_CLOSED') return SHOP_CLOSED;
    if (code === 'ORDER_OFF_ARRIVAL_COMPLEMENT' || code === 'ORDER_STAY_PRICE_MOVED') return refusal(409, code, 'orderOffArrival');
    if (code === 'RESOURCE_SLOT_TAKEN' || code === 'SESSIONS_OVERLAP') return refusal(409, 'SLOT_TAKEN', 'slotJustTaken');
    if (code === 'ORDER_PERSONS_EXCEEDED') {
      const line = ((judged && judged.lines) || []).find((l) => keyOf(l) === body.key);
      const left = Math.max(0, Number(body.left) || 0);
      const title = (line && line.shownTitle) || '';
      if (line && line.kind === 'breakfast') return refusal(409, 'PERSONS_EXCEEDED', 'breakfastPersons', { left });
      return refusal(409, 'PERSONS_EXCEEDED', left > 0 ? 'personsLeft' : 'personsNone', { left, title });
    }
    return refusal(409, 'STAY_NOT_WRITABLE', 'stayNotWritable');
  }

  /**
   * Rules 24, 25, 35 — the judged lines priced by the core engine, after the stay's card orders awaiting payment:
   * those hold the free units and minutes they were quoted with. → `{ lines, total }` or a refusal.
   */
  function price(stay, judged, lang) {
    const lines = commitLines(judged.lines);
    if (!lines.length) return { lines: [], charges: [], byKey: {}, total: 0 };
    const pending = orders().pendingLines(stay.id, { at: now() }).map(cartLineOf);
    const run = (list) => {
      let priced = commit.priceOrder(stay.id, list, { pending });
      // A pending order the fiche no longer takes (its hold lapsing) prices nothing: the order alone is. The persons a
      // pending order holds stay held (rule 55).
      const personsRefused = priced.body && priced.body.code === 'ORDER_PERSONS_EXCEEDED';
      if (priced.status !== 200 && pending.length && !personsRefused) priced = commit.priceOrder(stay.id, list);
      return priced;
    };
    let priced = run(lines);
    if (priced.status !== 200) return { refusal: engineRefusal(priced, judged) };
    // Rule 83 — the evening supplement of the bath's sessions, priced once with the order.
    const charges = eveningCharges(stay, judged, priced.byKey, lang);
    if (charges.length) {
      priced = run([...lines, ...charges.map((c) => ({ kind: 'charge', key: chargeKey('new', c.resourceId), label: c.label, amount: c.amount }))]);
      if (priced.status !== 200) return { refusal: engineRefusal(priced, judged) };
    }
    return { lines, charges, byKey: priced.byKey, total: priced.total };
  }

  /**
   * Rules 81-83 — the bath's evening supplement per resource of the order, computed by `hourly-resources` from the sessions
   * and what the order's line already bills: the hours the stay holds and the free minutes cover the day rate only.
   */
  function eveningCharges(stay, judged, byKey, lang) {
    const provider = scheduler();
    if (!provider || typeof provider.orderSupplement !== 'function') return [];
    return judged.lines.filter((l) => !l.unavailable && l.kept && l.kept.length).map((line) => {
      const hours = sessionsHours(line.kept);
      const covered = Number(line.heldHours || 0) + (line.item.freeMinutes ? Number(line.item.freeMinutes.left || 0) / 60 : 0);
      const amount = provider.orderSupplement({
        resourceId: line.id, propertyId: stay.propertyId, sessions: line.kept,
        lineGain: { amount: Number(byKey[keyOf(line)] || 0), hours: Math.max(0, Math.round((hours - covered) * 100) / 100) },
      });
      const label = `${line.title} — supplément soirée`;
      return amount > 0 ? { resourceId: line.id, amount, label, shownLabel: lang === 'en' ? `${line.shownTitle} — evening supplement` : `${line.shownTitle} — supplément soirée` } : null;
    }).filter(Boolean);
  }

  /** Rule 32 — a priced line ready to render; the snapshot an order stores is the same object. */
  function lineView(line, byKey, lang) {
    const T = labels.textOf(lang);
    const total = line.unavailable ? 0 : Number(byKey[keyOf(line)] || 0);
    const view = {
      kind: line.kind,
      id: line.id,
      title: line.shownTitle || line.title,
      ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
      ...(line.sessions ? { sessions: line.sessions.map((s) => ({ ...s, label: labels.sessionLabel(s, lang) })) } : {}),
      ...(line.kind === 'breakfast' ? { mornings: line.mornings, time: line.time, persons: line.persons } : {}),
      ...(line.unavailableMornings ? { unavailableMornings: line.unavailableMornings } : {}),
      unitPrice: line.item ? Number(line.item.included ? 0 : line.item.row.price || 0) : 0,
      total,
      totalLabel: line.item && line.item.included && total === 0 ? T.included : labels.priceLabel(total, lang),
      ...(line.unavailable ? { unavailable: true, unavailableReason: line.unavailableReason } : {}),
      ...(line.outOfStock ? { outOfStock: line.outOfStock } : {}),
    };
    if (view.title) view.label = labels.lineLabel({ ...view, sessions: line.kept || line.sessions }, lang);
    return view;
  }

  /**
   * Rule 55 — a priced article the engine adds nothing for (no free unit or minute left to explain it: a line the
   * fiche offers, for one) would be delivered at 0 €: refused, never confirmed free. Rule 60 — the free units or
   * minutes left explain only what they cover: the line's quantity, or its hours.
   */
  const freeCovers = (line) => {
    const { freeUnits, freeMinutes } = line.item;
    if (freeUnits) return Number(line.quantity) <= Number(freeUnits.left || 0);
    // Rule 82 — the hours the stay already holds are placed first: they explain a bath order that adds nothing to the fiche.
    if (line.kind === 'resource' && line.kept) return sessionsHours(line.kept) * 60 <= Number((freeMinutes && freeMinutes.left) || 0) + Number(line.heldHours || 0) * 60;
    return false;
  };
  const billable = (line) => Boolean(line.item) && !line.item.included && Number(line.item.row.price || 0) > 0 && !freeCovers(line);
  const unbilledLine = (judged, byKey) => judged.lines.find((l) => !l.unavailable && l.kind !== 'breakfast'
    && billable(l) && !(Number(byKey[keyOf(l)]) > 0));

  function quoteOf(guest, body, at, lang, { early = null } = {}) {
    const judged = judge(guest, body, at, lang);
    // Rule 80 — a session the picker would not offer is refused before anything is priced.
    const crafted = early ? early(judged) : null;
    if (crafted) return { refusal: crafted };
    const priced = price(guest.stay, judged, lang);
    if (priced.refusal) return { refusal: priced.refusal };
    const unbilled = unbilledLine(judged, priced.byKey);
    if (unbilled) return { refusal: refusal(409, 'ITEM_UNAVAILABLE', 'itemNotBillable', { title: unbilled.shownTitle }) };
    const lines = [
      ...judged.lines.map((l) => lineView(l, priced.byKey, lang)),
      ...priced.charges.map((c) => chargeView(c, lang)),
    ];
    return {
      judged,
      priced,
      quote: {
        lines,
        total: priced.total,
        totalLabel: labels.priceLabel(priced.total, lang),
        needsDelivery: judged.needsDelivery,
        ...(judged.needsDelivery ? { deliverAt: judged.deliverAt, ...(body.deliverAt && !judged.deliverAtValid ? { deliverAtUnavailable: true } : {}) } : {}),
      },
    };
  }

  const chargeLinesOf = (orderId, charges) => (charges || []).map((c) => ({ kind: 'charge', key: chargeKey(orderId, c.resourceId), label: c.label, amount: c.amount }));

  /** Rule 83 — the bath's evening supplement as a line of the order, ready to render. */
  const chargeView = (charge, lang) => ({
    kind: 'charge',
    id: charge.resourceId,
    title: charge.label,
    label: charge.shownLabel,
    total: charge.amount,
    totalLabel: labels.priceLabel(charge.amount, lang),
  });

  // The envelope's `details` (§4.3): an object here — the units left, the fresh quote — in the request's language.
  const fail = failGuest;

  function guarded(handler) {
    return async (req, res) => {
      try {
        return await handler(req, res);
      } catch (err) {
        if (err && err.status && err.code) return fail(res, err);
        throw err;
      }
    };
  }

  const SHOP_CLOSED = Object.freeze(refusal(409, 'SHOP_CLOSED', 'shopClosed'));
  const ORDERS_OPEN_ON_ARRIVAL = Object.freeze(refusal(409, 'ORDERS_OPEN_ON_ARRIVAL', 'ordersOpenOnArrival'));

  /**
   * Rules 27, 65-68 — orders are taken while the core collects them at the arrival or the departure: the refusal when
   * they are not (`closed`, or the stay's money still due), else null. → `{ refused, collection }`.
   */
  function openness(guest) {
    const collection = shop.collectionOf(guest.stay);
    if (shopState(collection).open) return { collection };
    return { collection, refused: collection === 'closed' ? SHOP_CLOSED : ORDERS_OPEN_ON_ARRIVAL };
  }

  /** `POST /orders/quote` — rule 32: the cart's total is always this answer. */
  const quote = guarded((req, res) => {
    const error = orderInputError(req.body, { withPayment: false });
    if (error) return fail(res, error);
    const lang = languageOf(req, req.guest.stay);
    const at = now();
    const { refused } = openness(req.guest);
    if (refused) return fail(res, refused);
    const out = quoteOf(req.guest, req.body, at, lang);
    if (out.refusal) return fail(res, out.refusal);
    return publicHttp.ok(res, out.quote);
  });

  const lodgingName = (propertyId) => {
    const lodging = lodgings().get(propertyId);
    return lodging ? lodging.name : '';
  };

  /** Rule 44 — « Commandes clients »: every confirmed or paid order, to the staff who subscribed. Best effort. */
  function notifyStaff(order, { conflict = false, refundCents = 0 } = {}) {
    const stay = stays().byId(order.reservationId) || {};
    const text = labels.pushText(order, { lodging: lodgingName(stay.propertyId), firstName: stay.clientFirstName, now: now() });
    const refund = refundCents > 0 ? `${text} — trop-perçu de ${labels.priceLabel(refundCents / 100)} à rembourser` : text;
    const body = conflict ? `${text} — payée, mais créneau, article ou prix plus disponible : à rembourser` : refund;
    Promise.resolve()
      .then(() => push().sendToPref('guest-orders', { title: conflict ? 'Commande client à rembourser' : `Commande client #${order.id}`, body, url: `/commandes-app?order=${order.id}` }))
      .catch(() => {});
  }

  // Rule 43 — a staff-prepared line says so in the order's own snapshot: the planning card lists those lines only.
  const snapshot = (judged, byKey, lang, charges = []) => [...judged.lines.filter((l) => !l.unavailable).map((l) => {
    const view = lineView(l, byKey, lang);
    const { unavailableMornings, label, ...kept } = view;
    kept.title = l.title;
    if (kept.sessions) kept.sessions = l.kept.map(({ date, start, end }) => ({ date, start, end }));
    if (l.item && isStaffItem(l.item)) kept.needsStaff = true;
    if (l.kept) kept.addedHours = Math.max(0, Math.round((sessionsHours(l.kept) - Number(l.heldHours || 0)) * 100) / 100);
    return kept;
  }), ...charges.map((c) => ({ kind: 'charge', id: c.resourceId, title: c.label, total: c.amount }))];

  /** §4.3 — the first answer to an order a replayed `Idempotency-Key` names. */
  function replay(res, order) {
    if (order.payment === 'card') {
      const waiting = order.status === 'awaiting_payment';
      const live = waiting && order.heldUntil && new Date(order.heldUntil) > now();
      if (live && order.paymentUrl) return publicHttp.ok(res, { orderId: order.id, paymentUrl: order.paymentUrl });
      if (live) return fail(res, refusal(409, 'ORDER_IN_PROGRESS', 'orderInProgress'));
      // Paid meanwhile: the first order stands, shown without a link to pay again.
      if (['paid', 'delivered'].includes(order.status)) return publicHttp.ok(res, { orderId: order.id, status: order.status });
      if (!waiting) return fail(res, refusal(409, 'ORDER_KEY_SPENT', 'orderKeySpent'));
      return fail(res, refusal(502, 'PAYMENT_UNAVAILABLE', 'cardUnavailable'));
    }
    return publicHttp.ok(res, { orderId: order.id, status: 'confirmed' });
  }

  const isUniqueClash = (err) => Boolean(err && err.code === 'SQLITE_CONSTRAINT_UNIQUE');

  /**
   * Rule 80 — a session the slot picker would not offer is refused first, before any pricing, nothing written: `SLOT_TAKEN`
   * when another use of the bath holds it, `SLOT_UNAVAILABLE` for every other reason (closed, past, heating, staff, off the grid).
   */
  function craftedSession(judged) {
    const bad = judged.lines.flatMap((l) => (l.sessions || []).filter((x) => x.unavailable && SLOT_REASONS.has(x.reason)));
    if (!bad.length) return null;
    return bad.some((x) => x.reason === 'taken') ? refusal(409, 'SLOT_TAKEN', 'slotGone') : refusal(409, 'SLOT_UNAVAILABLE', 'slotUnavailable');
  }

  /** `POST /orders` — rules 30, 33-37, 80. */
  const create = guarded(async (req, res) => {
    const error = orderInputError(req.body, { withPayment: true });
    if (error) return fail(res, error);
    const rawKey = req.get('Idempotency-Key');
    if (rawKey !== undefined && !CLIENT_KEY.test(rawKey)) return fail(res, invalid('invalidRequest'));
    const clientKey = rawKey || null;
    const sessionId = req.guest.session.id;
    const earlier = clientKey ? orders().findByClientKey(sessionId, clientKey) : null;
    if (earlier) return replay(res, earlier);
    const { stay } = req.guest;
    const lang = languageOf(req, stay);
    const at = now();
    const { refused } = openness(req.guest);
    if (refused) return fail(res, refused);
    const out = quoteOf(req.guest, req.body, at, lang, { early: craftedSession });
    if (out.refusal) return fail(res, out.refusal);
    const { judged, priced, quote: answer } = out;
    const gone = judged.lines.filter((l) => l.unavailable || (l.sessions || []).some((s) => s.unavailable) || l.unavailableMornings);
    const short = gone.find((l) => l.outOfStock);
    if (short) {
      return fail(res, { ...refusal(409, 'OUT_OF_STOCK'), message: short.outOfStock.label }, {
        itemKey: `${short.kind}:${short.id}`, left: short.outOfStock.left, quote: answer,
      });
    }
    if (gone.length) return fail(res, refusal(409, 'ITEM_UNAVAILABLE', 'itemGone'), { quote: answer });
    if (judged.needsDelivery && !judged.deliverAt) {
      return fail(res, req.body.deliverAt
        ? refusal(409, 'DELIVERY_TIME_UNAVAILABLE', 'deliveryGone')
        : invalid('chooseDelivery'), { quote: answer });
    }
    const ceiling = Number(maxOrderTotal()) || 500;
    if (priced.total > ceiling) return fail(res, limit('maxTotal', { amount: labels.priceLabel(ceiling, lang) }));
    const lines = snapshot(judged, priced.byKey, lang, priced.charges);
    const free = priced.total <= 0;
    if (!free && req.body.payment === 'none') return fail(res, invalid('choosePayment'));
    const mode = fulfilment();
    const delivery = { fulfilment: mode.mode, pickupPlace: mode.place };

    // Rules 25, 34 — a note or 0 € order: confirmed and written on the fiche in one transaction.
    if (free || req.body.payment === 'note') {
      let refused = null;
      let order = null;
      let moved = [];
      try {
        db().transaction(() => {
          order = orders().create({
            reservationId: stay.id, sessionId, payment: free ? 'none' : 'note', status: 'confirmed',
            lines, total: priced.total, deliverAt: judged.deliverAt, ...delivery, clientKey, now: at,
          });
          const written = commit.commitOrder(stay.id, { ...orderNaming(order.id), lines: [...priced.lines, ...chargeLinesOf(order.id, priced.charges)] });
          if (!written || written.status !== 200) {
            refused = engineRefusal(written || { body: {} }, judged);
            throw refused;
          }
          // Rule 66 — the core says where the order is collected: the arrival complement or the end-of-stay one.
          orders().setCollectAt(order.id, written.collectAt);
          // Rule 35 — quoted after a card order awaiting payment, it adds less to the fiche than its quote: that order adds the rest.
          orders().setDeferred(order.id, Math.round(priced.total * 100) - Math.round(Number(written.total || 0) * 100));
          moved = countStock(stay.id, at);
        })();
      } catch (err) {
        if (clientKey && isUniqueClash(err)) return replay(res, orders().findByClientKey(sessionId, clientKey));
        if (err !== refused) throw err;
        return fail(res, refused);
      }
      alertStock(moved);
      notifyStaff(order);
      return publicHttp.ok(res, { orderId: order.id, status: 'confirmed' });
    }

    // Rule 33 — « Payer maintenant »: the order holds its slots while its link lives (rule 35).
    // Rule 35 — one card order waits for its payment at a time: a second one would be priced after the first's
    // allowances, then committed before it if paid first (review of 2026-11-09).
    if (orders().livePendingCard(stay.id, { at })) {
      return fail(res, refusal(409, 'CARD_ORDER_PENDING', 'cardPending'));
    }
    if (!paymentProviders.active()) return fail(res, refusal(409, 'CARD_UNAVAILABLE', 'cardToNote'));
    let order;
    try {
      order = orders().create({
        reservationId: stay.id, sessionId, payment: 'card', status: 'awaiting_payment',
        lines, total: priced.total, deliverAt: judged.deliverAt, heldUntil: new Date(at.getTime() + HOLD_MS).toISOString(), ...delivery, clientKey, now: at,
      });
    } catch (err) {
      if (clientKey && isUniqueClash(err)) return replay(res, orders().findByClientKey(sessionId, clientKey));
      throw err;
    }
    // Rule 37ter — the units it holds lower what is left at once.
    alertStock([...stock().unitsOfLines(lines).keys()]);
    const host = guestHost();
    try {
      const link = await payments().basketLink(stay.id, {
        source: ORDER_SOURCE,
        ref: order.id,
        title: `Commande #${order.id}`,
        lines: basketLines(lines, priced.total),
      }, { redirectUrl: host ? `https://${host}/commande/${order.id}` : null });
      orders().setPaymentLink(order.id, link.linkId, link.url);
      return publicHttp.ok(res, { orderId: order.id, paymentUrl: link.url });
    } catch (err) {
      orders().markFailed(order.id, now());
      return fail(res, refusal((err && err.httpStatus) || 502, (err && err.error) || 'PAYMENT_UNAVAILABLE', 'cardUnavailable'));
    }
  });

  /**
   * Rule 33 — the link bills exactly the quoted total: the order's own lines, and what the engine raised beside them
   * (a percentage of the stay, such as an insurance) as one more line.
   */
  function basketLines(lines, total) {
    const own = lines.filter((l) => l.total > 0).map((l) => ({ title: l.title, amountCents: Math.round(l.total * 100) }));
    const rest = Math.round(total * 100) - own.reduce((sum, l) => sum + l.amountCents, 0);
    return rest > 0 ? [...own, { title: 'Ajustement du séjour lié à la commande', amountCents: rest }] : own;
  }

  /** Rules 38, 41ter — what a guest reads of an order. */
  function orderView(order, { lang, resourceLines = null }) {
    const T = labels.textOf(lang);
    const chip = labels.deliveryChip(order, lang);
    const stay = stays().byId(order.reservationId) || {};
    const promised = labels.promiseOf(order, { lodging: lodgingName(stay.propertyId), now: now(), lang });
    const arrival = order.collectAt === 'arrival' ? stays().arrivalComplementState(order.reservationId) : null;
    const notices = [];
    if (order.status === 'awaiting_payment') notices.push(T.awaitingCard);
    if (order.status === 'paid_conflict') notices.push(T.conflict);
    if (order.deliverMoved && ['paid', 'confirmed'].includes(order.status)) notices.push(order.deliverAt ? T.moved(labels.momentLabel(order.deliverAt, lang)) : T.movedNone);
    // Rule 73 — a stay moved under its order: the time is no longer inside the dates, the team replans it.
    if (['paid', 'confirmed'].includes(order.status) && outsideStay(order, stay)) notices.push(T.reviewTime);
    // Edge case — the planning is the truth: a session of the order the operator moved or removed.
    if (resourceLines && ['confirmed', 'paid', 'delivered'].includes(order.status)) {
      const placed = new Set(resourceLines.flatMap((l) => (l.sessions || []).map((s) => `${l.resourceId}|${s.date}|${s.start}|${s.end}`)));
      const moved = order.lines.some((l) => l.kind === 'resource' && (l.sessions || []).some((s) => !placed.has(`${l.id}|${s.date}|${s.start}|${s.end}`)));
      if (moved) notices.push(T.modified);
    }
    return {
      id: order.id,
      createdAt: order.createdAt,
      deliverAt: order.deliverAt,
      lines: order.lines.map(({ needsStaff, ...l }) => ({ ...l, label: labels.lineLabel(l, lang), totalLabel: labels.priceLabel(l.total, lang) })),
      total: order.total,
      totalLabel: labels.priceLabel(order.total, lang),
      payment: order.payment,
      status: order.status,
      statusLabel: labels.statusLabel(order, lang, { arrival }),
      collectAt: order.collectAt === 'arrival' ? 'arrival' : 'departure',
      // Rules 76, 87 — an order the team changed at the arrival says so, with its new lines and total above.
      ...(order.amendmentsJson && order.amendmentsJson !== '[]' ? { amendedLabel: T.amended } : {}),
      ...(chip ? { deliveryLabel: chip } : {}),
      fulfilment: order.fulfilment === 'pickup' ? 'pickup' : 'delivery',
      promise: promised.promise,
      ...(promised.extraPromises.length ? { extraPromises: promised.extraPromises } : {}),
      movedNotice: promised.movedNotice,
      ...(notices.length ? { notices } : {}),
      // Rule 35 — « Reprendre le paiement »: an unpaid card order's link, while it still lives (its 30 minutes).
      ...(order.status === 'awaiting_payment' && order.paymentUrl && order.heldUntil && Date.parse(order.heldUntil) > now().getTime()
        ? { paymentUrl: order.paymentUrl } : {}),
      // Rule 35 — an abandoned order's lines go back in the cart.
      ...(order.status === 'abandoned' ? { cartLines: order.lines.filter((l) => !isCharge(l)).map(cartLineOf) } : {}),
    };
  }

  function cartLineOf(line) {
    if (isCharge(line)) return { kind: 'charge', key: chargeKey('pending', line.id), label: line.title, amount: line.total };
    if (line.kind === 'breakfast') return { kind: 'breakfast', id: line.id, mornings: line.mornings, time: line.time, persons: line.persons };
    if (line.kind === 'resource' && Array.isArray(line.sessions) && line.sessions.length) {
      return { kind: 'resource', id: line.id, sessions: line.sessions.map(({ date, start, end }) => ({ date, start, end })) };
    }
    return { kind: line.kind, id: line.id, quantity: line.quantity };
  }

  const placedLines = (stay) => shop.soldFor({ stay, lodging: { propertyId: stay.propertyId } }).extras.resourceLines;

  /** `GET /orders` — rule 38: the stay's orders from every session. */
  function list(req, res) {
    const { stay } = req.guest;
    const lang = languageOf(req, stay);
    const resourceLines = placedLines(stay);
    return publicHttp.ok(res, { orders: orders().listForStay(stay.id).map((o) => orderView(o, { lang, resourceLines })) });
  }

  const ownOrder = (req) => {
    const id = /^\d+$/.test(String(req.params.id)) ? Number(req.params.id) : NaN;
    const order = Number.isInteger(id) ? orders().findById(id) : null;
    return order && Number(order.reservationId) === Number(req.guest.stay.id) ? order : null;
  };
  const notFound = (res) => fail(res, refusal(404, 'ORDER_NOT_FOUND', 'orderNotFound'));

  // §4.3 — when each link was last read at the provider for the return page.
  const refreshedAt = new Map();

  /** `GET /orders/:id` — the return page polls it; an unpaid card order reads its link at the provider, every 10 s at most. */
  async function read(req, res) {
    let order = ownOrder(req);
    if (!order) return notFound(res);
    const at = now().getTime();
    if (order.status !== 'awaiting_payment' && order.paymentLinkId) refreshedAt.delete(order.paymentLinkId);
    if (order.status === 'awaiting_payment' && order.paymentLinkId && !(at - (refreshedAt.get(order.paymentLinkId) || -Infinity) < REFRESH_MS)) {
      refreshedAt.set(order.paymentLinkId, at);
      await payments().refreshBasketLink(order.paymentLinkId);
      order = orders().findById(order.id);
    }
    return publicHttp.ok(res, orderView(order, { lang: languageOf(req, req.guest.stay), resourceLines: placedLines(req.guest.stay) }));
  }

  /** `POST /orders/:id/abandon` — rule 35: the guest gives up the card payment; holds released, lines back in the cart. */
  async function abandon(req, res) {
    const order = ownOrder(req);
    if (!order) return notFound(res);
    if (order.status !== 'awaiting_payment') return fail(res, refusal(409, 'ORDER_NOT_PENDING', 'orderNotPending'));
    const moved = orders().markAbandoned(order.id, now());
    if (moved && order.paymentLinkId) {
      try { await payments().withdrawBasketLink(order.paymentLinkId); } catch { /* the link lapses within 30 minutes anyway */ }
    }
    const current = orders().findById(order.id);
    return publicHttp.ok(res, orderView(current, { lang: languageOf(req, req.guest.stay) }));
  }

  /**
   * Rule 35 — a paid order whose `deliverAt` is earlier than payment + lead moves to the next delivery time, and
   * says so. `{ deliverAt, moved }`.
   */
  function deliveryAfterPayment(order, stay, at) {
    if (!order.deliverAt) return { deliverAt: null, moved: false };
    const lodging = { propertyId: stay.propertyId };
    const { sold } = shop.soldFor({ stay, lodging });
    const staff = order.lines.filter((l) => l.kind === 'option')
      .map((l) => sold.find((s) => s.kind === 'option' && Number(s.row.id) === Number(l.id)))
      .filter((s) => s && isStaffItem(s));
    const lead = staff.length ? Math.max(...staff.map((s) => Number(s.item.leadMinutes) || 0)) : 0;
    const wanted = Date.parse(order.deliverAt);
    const ready = at.getTime() + lead * 60000;
    if (wanted >= ready) return { deliverAt: order.deliverAt, moved: false };
    // The wall clock drops the seconds: the next time is judged against the payment's exact instant.
    const next = deliveryInstants({ stay, lodging, leadMinutes: lead, at }).find((ms) => ms >= Math.max(wanted, ready));
    return { deliverAt: next ? new Date(next).toISOString() : null, moved: true };
  }

  /** The order's sessions against the planning as it is now, its own holds lifted (rule 36). */
  function sessionsStillFree(order, stay, at) {
    const lodging = { propertyId: stay.propertyId };
    const canIgnite = ignitionInHours(shop.scheduleOf(lodging, at));
    return order.lines.filter((l) => l.kind === 'resource' && Array.isArray(l.sessions) && l.sessions.length).every((line) => {
      const verdict = scheduler() && scheduler().validateSessions({
        resourceId: Number(line.id), propertyId: stay.propertyId, stay, sessions: line.sessions, now: at, heatFrom: at, canIgnite,
      });
      return Boolean(verdict && verdict.ok);
    });
  }

  const commitLinesOf = (order) => order.lines.map((line) => (isCharge(line)
    ? { kind: 'charge', key: chargeKey(order.id, line.id), label: line.title, amount: line.total }
    : cartLineOf(line)));

  /** Rule 37quater — a late payment whose units went meanwhile is a conflict, like a taken slot. Its own holds are lifted. */
  function unitsStillLeft(order, at) {
    const stocks = stock().states(at);
    return [...stock().unitsOfLines(order.lines).entries()].every(([key, units]) => {
      const state = stocks.get(key);
      return !state || (!state.soldOut && state.left >= units);
    });
  }

  /**
   * Rules 35-36 — the order's side of its paid link, run by the core inside the payment's effect. Committed with
   * its payment recorded on the ledger when its slots are still free (on time, or late after its expiry), else
   * `paid_conflict`: nothing reaches the fiche and the core flags the money « à rembourser ». The fiche is never
   * billed beyond the payment: an order that now costs more (beyond what the orders committed while it awaited its
   * payment left to it) is a conflict; one that costs less has the gap flagged « à rembourser » (`refundCents`).
   */
  function paid({ reservationId, ref, amountCents, paidDate, paidAt, providerPaymentId }) {
    const order = orders().findById(ref);
    if (!order || Number(order.reservationId) !== Number(reservationId)) return { refundOwed: true, reason: 'commande introuvable' };
    if (['paid', 'delivered', 'paid_conflict', 'confirmed'].includes(order.status)) return { effect: 'guest-order-already-settled' };
    const at = now();
    const stay = stays().byId(order.reservationId);
    const paidCents = Math.round(Number(amountCents) || 0);
    let outcome = null;
    let moved = [];
    db().transaction(() => {
      // Its own holds are not someone else's slot: lifted before the planning is read again.
      db().prepare('UPDATE guest_orders SET heldUntil = NULL WHERE id = ?').run(order.id);
      const conflict = (reason = 'créneau ou article plus disponible, commande non honorée') => {
        orders().markPaidConflict(order.id, { now: at, paidAt });
        outcome = { refundOwed: true, reason };
      };
      // Rule 35 — abandoned, its lines went back to the cart: a payment landing now is never committed.
      if (order.status === 'abandoned') return conflict('commande abandonnée avant le paiement, commande non honorée');
      // Rule 37quater — paid while it awaited its payment, the order held its units; a late one finds what is left.
      const late = order.status !== 'awaiting_payment';
      if (!stay || stay.kind !== 'reservation' || !sessionsStillFree(order, stay, at) || (late && !unitsStillLeft(order, at))) return conflict();
      const delivery = deliveryAfterPayment(order, stay, at);
      let written;
      try {
        written = commit.commitOrder(order.reservationId, {
          ...orderNaming(order.id, { paid: true }),
          lines: commitLinesOf(order),
          paid: { amountCents: paidCents, paidDate, reference: providerPaymentId },
          within: (result) => {
            const gap = Math.round(Number(result.total || 0) * 100) - paidCents;
            if (gap > 0) {
              const deferred = orders().deferredFor(order);
              if (deferred.available < gap) throw PRICE_ROSE;
              deferred.take(gap);
            }
            orders().setCollectAt(order.id, result.collectAt);
            orders().markPaid(order.id, { now: at, paidAt, deliverAt: delivery.deliverAt, deliverMoved: delivery.moved });
          },
        });
      } catch (err) {
        if (err !== PRICE_ROSE) throw err;
        return conflict('prix de la commande augmenté avant le paiement, commande non honorée');
      }
      if (!written || written.status !== 200) return conflict();
      moved = countStock(order.reservationId, at);
      const excess = Number(written.excessCents) || 0;
      outcome = excess > 0
        ? {
          effect: 'guest-order-paid', refundOwed: true, refundCents: excess,
          reason: `commande facturée ${labels.priceLabel((paidCents - excess) / 100)} au lieu de ${labels.priceLabel(paidCents / 100)}`,
        }
        : { effect: 'guest-order-paid' };
      return null;
    })();
    alertStock(moved);
    const after = orders().findById(order.id);
    const conflicted = after.status === 'paid_conflict';
    notifyStaff(after, { conflict: conflicted, refundCents: conflicted ? 0 : Number(outcome.refundCents) || 0 });
    return outcome;
  }

  /** Rule 36 — every minute: an order unpaid 30 minutes on expires and its slots go back to the planning. */
  function expireDue() {
    return orders().expireDue(now());
  }

  return {
    quote, create, list, read: guarded(read), abandon: guarded(abandon), paid, expireDue, orderView,
  };
}

module.exports = {
  ORDER_SOURCE, ORDER_REFUND_LABELS, buildOrdersController, orderInputError,
};
