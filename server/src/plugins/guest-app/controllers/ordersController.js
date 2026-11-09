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
const { deliveryTimes, ignitionInHours, wallClock } = require('../serviceHours');
const { languageOf } = require('./sessionController');
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
// Rule 30 — a session the planning no longer lets the guest book; `SLOT_TAKEN` and the picker reloads.
const SLOT_REASONS = new Set(['taken', 'past', 'heating', 'staff', 'closed', 'duration']);

const invalid = (message) => ({ status: 400, code: 'INVALID_INPUT', message });
const limit = (message) => ({ status: 400, code: 'ORDER_LIMIT', message });

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const positiveInt = (v) => Number.isInteger(v) && v > 0;
const keyOf = (line) => `${line.kind === 'resource' ? 'res' : 'opt'}:${Number(line.id)}`;

function sessionError(s) {
  if (!isObject(s) || Object.keys(s).some((k) => !['date', 'start', 'end'].includes(k))) return 'Un créneau est invalide.';
  if (!isRealIsoDay(s.date) || !HHMM.test(String(s.start)) || !HHMM.test(String(s.end)) || s.start >= s.end) return 'Un créneau est invalide.';
  return null;
}

function lineError(line) {
  if (!isObject(line) || !KINDS.includes(line.kind) || !positiveInt(line.id)) return invalid('Un article du panier est invalide.');
  if (line.kind === 'breakfast') {
    if (Object.keys(line).some((k) => !['kind', 'id', 'mornings', 'time', 'persons'].includes(k))) return invalid('Un article du panier est invalide.');
    if (!Array.isArray(line.mornings) || !line.mornings.length || line.mornings.length > MAX_MORNINGS
      || line.mornings.some((d) => !isRealIsoDay(d)) || new Set(line.mornings).size !== line.mornings.length) return invalid('Les matins choisis sont invalides.');
    if (!HHMM.test(String(line.time))) return invalid('L’heure choisie est invalide.');
    if (!positiveInt(line.persons) || line.persons > 50) return invalid('Le nombre de personnes est invalide.');
    return null;
  }
  if (Object.keys(line).some((k) => !['kind', 'id', 'quantity', 'sessions'].includes(k))) return invalid('Un article du panier est invalide.');
  if (line.sessions !== undefined) {
    if (line.kind !== 'resource' || !Array.isArray(line.sessions) || !line.sessions.length) return invalid('Un article du panier est invalide.');
    if (line.sessions.length > MAX_SESSIONS) return limit(`${MAX_SESSIONS} créneaux au plus par article.`);
    const bad = line.sessions.map(sessionError).find(Boolean);
    if (bad) return invalid(bad);
    return line.quantity === undefined ? null : invalid('Un créneau ne prend pas de quantité.');
  }
  if (!Number.isInteger(line.quantity) || line.quantity < 1) return invalid('Une quantité est invalide.');
  return null;
}

/** The request's shape, judged before anything reads it: `{ status, code, message }` or null. */
function orderInputError(body, { withPayment }) {
  const allowed = withPayment ? ['lines', 'deliverAt', 'payment', 'returnPath'] : ['lines', 'deliverAt'];
  if (!isObject(body) || Object.keys(body).some((k) => !allowed.includes(k))) return invalid('Requête invalide.');
  if (!Array.isArray(body.lines) || !body.lines.length) return invalid('Le panier est vide.');
  if (body.lines.length > MAX_LINES) return limit(`${MAX_LINES} articles au plus par commande.`);
  const bad = body.lines.map(lineError).find(Boolean);
  if (bad) return bad;
  if (new Set(body.lines.map(keyOf)).size !== body.lines.length) return invalid('Un article apparaît deux fois dans le panier.');
  if (body.deliverAt !== undefined && body.deliverAt !== null
    && (typeof body.deliverAt !== 'string' || body.deliverAt.length > 40 || !Number.isFinite(Date.parse(body.deliverAt)))) return invalid('L’heure de livraison est invalide.');
  if (withPayment && !PAYMENTS.includes(body.payment)) return invalid('Le mode de paiement est invalide.');
  if (withPayment && body.returnPath !== undefined && (typeof body.returnPath !== 'string' || body.returnPath.length > 200)) return invalid('Requête invalide.');
  return null;
}

const minutesOf = (time) => {
  const [h, m] = String(time || '').split(':').map(Number);
  return h * 60 + m;
};
const sessionsHours = (sessions) => sessions.reduce((sum, s) => sum + Math.max(0, minutesOf(s.end) - minutesOf(s.start)), 0) / 60;

const instantOfMoment = ({ date, minutes }) => wallClockToDate(date, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);

function buildOrdersController({
  db, orders, stays, lodgings, shop, scheduler, serviceHours, commit, payments, push, maxOrderTotal, guestHost, now,
  stock, alertStock = () => {}, fulfilment = () => ({ mode: 'delivery', place: null }),
}) {
  /** Rule 37ter — the stay's counts brought to date in the commit's own transaction. → the articles that moved. */
  const countStock = (reservationId, at) => stock().reconcile(reservationId, parisDate(at));

  /** Rule 41 — the delivery times of the staff-prepared lines, as instants (ms) from `at`. */
  function deliveryInstants({ stay, lodging, leadMinutes, at }) {
    return deliveryTimes({ now: wallClock(at), stay, leadMinutes, schedule: shop.scheduleOf(lodging, at) })
      .map((moment) => instantOfMoment(moment).getTime());
  }

  /**
   * Rules 23, 25, 27bis, 29, 31, 41 — each line against what the shop sells now: unavailable lines and sessions are
   * said, never dropped silently; what can be ordered goes to the engine. A thrown `{ status, code }` is a refusal
   * of the request itself (a quantity over `maxQuantity`).
   */
  function judge(guest, body, at, lang) {
    const { stay, lodging } = guest;
    const T = labels.textOf(lang);
    const { sold } = shop.soldFor(guest);
    const party = Math.max(1, Number(stay.adults || 0) + Number(stay.teens || 0) + Number(stay.children || 0));
    const today = parisDate(at);
    const clock = (toParisIso(at) || '').slice(11, 16);
    const canIgnite = ignitionInHours(shop.scheduleOf(lodging, at));
    const stocks = stock().states(at);
    const judged = body.lines.map((asked) => {
      const item = sold.find((s) => s.kind === asked.kind && Number(s.row.id) === Number(asked.id));
      const base = { kind: asked.kind, id: Number(asked.id), title: item ? (item.row.title || item.row.name) : null };
      if (!item) return { ...base, asked, unavailable: true, unavailableReason: T.unavailable };
      if (item.alreadyIncluded) return { ...base, asked, item, unavailable: true, unavailableReason: T.alreadyIncluded };
      const maxQuantity = Number(item.item.maxQuantity);
      if (asked.kind === 'breakfast') {
        if (asked.persons > party) throw invalid('Le nombre de personnes dépasse celui du séjour.');
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
        if (!asked.sessions) throw invalid('Choisissez un créneau.');
        const verdict = scheduler() && scheduler().validateSessions({
          resourceId: Number(asked.id), propertyId: lodging.propertyId, stay, sessions: asked.sessions, now: at, canIgnite,
        });
        if (!verdict) return { ...base, asked, item, unavailable: true, unavailableReason: T.unavailable };
        const sessions = verdict.results.map((r) => ({
          date: r.date, start: r.start, end: r.end, ...(r.ok ? {} : { unavailable: true, reason: r.reason, reasonLabel: T.slot[r.reason] || T.unavailable }),
        }));
        const kept = sessions.filter((s) => !s.unavailable).map(({ date, start, end }) => ({ date, start, end }));
        const hours = sessionsHours(kept);
        if (item.included && hours > Number(item.includedLeft || 0)) return { ...base, asked, item, sessions, unavailable: true, unavailableReason: T.allowanceUsed };
        return { ...base, asked, item, sessions, kept, ...(kept.length ? {} : { unavailable: true, unavailableReason: sessions[0].reasonLabel }) };
      }
      if (asked.sessions) throw invalid('Cet article ne se réserve pas sur un créneau.');
      if (asked.quantity > maxQuantity) throw limit(`${maxQuantity} au plus pour « ${base.title} ».`);
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

  /** A core refusal of the fiche's save, in the words of the guest app. */
  function engineRefusal(result) {
    const code = result.body && result.body.code;
    if (code === 'MID_STAY_EXTRAS_CLOSED') return { status: 409, code: 'SHOP_CLOSED', message: 'La boutique est fermée pour ce séjour.' };
    if (code === 'RESOURCE_SLOT_TAKEN' || code === 'SESSIONS_OVERLAP') return { status: 409, code: 'SLOT_TAKEN', message: 'Ce créneau vient d’être pris.' };
    return { status: 409, code: 'STAY_NOT_WRITABLE', message: 'Commande impossible pour ce séjour : contactez l’équipe.' };
  }

  /**
   * Rules 24, 25, 35 — the judged lines priced by the core engine, after the stay's card orders awaiting payment:
   * those hold the free units and minutes they were quoted with. → `{ lines, total }` or a refusal.
   */
  function price(stay, judged) {
    const lines = commitLines(judged.lines);
    if (!lines.length) return { lines: [], byKey: {}, total: 0 };
    const pending = orders().pendingLines(stay.id).map(cartLineOf);
    let priced = commit.priceOrder(stay.id, lines, { pending });
    // A pending order the fiche no longer takes (its hold lapsing) prices nothing: the order alone is.
    if (priced.status !== 200 && pending.length) priced = commit.priceOrder(stay.id, lines);
    if (priced.status !== 200) return { refusal: engineRefusal(priced) };
    return { lines, byKey: priced.byKey, total: priced.total };
  }

  /** Rule 32 — a priced line ready to render; the snapshot an order stores is the same object. */
  function lineView(line, byKey, lang) {
    const T = labels.textOf(lang);
    const total = line.unavailable ? 0 : Number(byKey[keyOf(line)] || 0);
    const view = {
      kind: line.kind,
      id: line.id,
      title: line.title,
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
    if (line.title) view.label = labels.lineLabel({ ...view, sessions: line.kept || line.sessions, title: line.title }, lang);
    return view;
  }

  function quoteOf(guest, body, at, lang) {
    const judged = judge(guest, body, at, lang);
    const priced = price(guest.stay, judged);
    if (priced.refusal) return { refusal: priced.refusal };
    const lines = judged.lines.map((l) => lineView(l, priced.byKey, lang));
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

  // The envelope's `details` (§4.3): an object here — the units left, the fresh quote — which publicHttp.fail, built for
  // lists of field errors, would drop.
  const fail = (res, refusal, details) => (details && !Array.isArray(details)
    ? res.status(refusal.status).json({ error: { code: refusal.code, message: refusal.message, details } })
    : publicHttp.fail(res, refusal.status, refusal.code, refusal.message, details));

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

  const SHOP_CLOSED = Object.freeze({ status: 409, code: 'SHOP_CLOSED', message: 'La boutique est fermée pour ce séjour.' });

  /** Rule 27 — orders are taken exactly while the fiche takes mid-stay extras, by a stay session. */
  const shopOpen = (guest, at) => shopState(guest.mode, shop.soldFor(guest).extras.window, parisDate(at)).open;

  /** `POST /orders/quote` — rule 32: the cart's total is always this answer. */
  const quote = guarded((req, res) => {
    const error = orderInputError(req.body, { withPayment: false });
    if (error) return fail(res, error);
    const lang = languageOf(req, req.guest.stay);
    const at = now();
    if (!shopOpen(req.guest, at)) return fail(res, SHOP_CLOSED);
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
    const text = labels.pushText(order, { lodging: lodgingName(stay.propertyId), firstName: stay.clientFirstName });
    const refund = refundCents > 0 ? `${text} — trop-perçu de ${labels.priceLabel(refundCents / 100)} à rembourser` : text;
    const body = conflict ? `${text} — payée, mais créneau, article ou prix plus disponible : à rembourser` : refund;
    Promise.resolve()
      .then(() => push().sendToPref('guest-orders', { title: conflict ? 'Commande client à rembourser' : `Commande client #${order.id}`, body, url: `/commandes-app?order=${order.id}` }))
      .catch(() => {});
  }

  // Rule 43 — a staff-prepared line says so in the order's own snapshot: the planning card lists those lines only.
  const snapshot = (judged, byKey, lang) => judged.lines.filter((l) => !l.unavailable).map((l) => {
    const view = lineView(l, byKey, lang);
    const { unavailableMornings, label, ...kept } = view;
    if (kept.sessions) kept.sessions = l.kept.map(({ date, start, end }) => ({ date, start, end }));
    if (l.item && isStaffItem(l.item)) kept.needsStaff = true;
    return kept;
  });

  /** §4.3 — the first answer to an order a replayed `Idempotency-Key` names. */
  function replay(res, order) {
    if (order.payment === 'card') {
      if (order.paymentUrl) return publicHttp.ok(res, { orderId: order.id, paymentUrl: order.paymentUrl });
      if (order.status === 'awaiting_payment') return fail(res, { status: 409, code: 'ORDER_IN_PROGRESS', message: 'Cette commande est en cours d’enregistrement.' });
      return fail(res, { status: 502, code: 'PAYMENT_UNAVAILABLE', message: 'Le paiement par carte est indisponible.' });
    }
    return publicHttp.ok(res, { orderId: order.id, status: 'confirmed' });
  }

  const isUniqueClash = (err) => Boolean(err && err.code === 'SQLITE_CONSTRAINT_UNIQUE');

  /** `POST /orders` — rules 30, 33-37. */
  const create = guarded(async (req, res) => {
    const error = orderInputError(req.body, { withPayment: true });
    if (error) return fail(res, error);
    const rawKey = req.get('Idempotency-Key');
    if (rawKey !== undefined && !CLIENT_KEY.test(rawKey)) return fail(res, invalid('Requête invalide.'));
    const clientKey = rawKey || null;
    const sessionId = req.guest.session.id;
    const earlier = clientKey ? orders().findByClientKey(sessionId, clientKey) : null;
    if (earlier) return replay(res, earlier);
    const { stay } = req.guest;
    const lang = languageOf(req, stay);
    const at = now();
    if (!shopOpen(req.guest, at)) return fail(res, SHOP_CLOSED);
    const out = quoteOf(req.guest, req.body, at, lang);
    if (out.refusal) return fail(res, out.refusal);
    const { judged, priced, quote: answer } = out;
    const gone = judged.lines.filter((l) => l.unavailable || (l.sessions || []).some((s) => s.unavailable) || l.unavailableMornings);
    const short = gone.find((l) => l.outOfStock);
    if (short) {
      return fail(res, { status: 409, code: 'OUT_OF_STOCK', message: short.outOfStock.label }, {
        itemKey: `${short.kind}:${short.id}`, left: short.outOfStock.left, quote: answer,
      });
    }
    if (gone.length) {
      const slot = gone.some((l) => (l.sessions || []).some((s) => s.unavailable && SLOT_REASONS.has(s.reason)));
      return fail(res, slot
        ? { status: 409, code: 'SLOT_TAKEN', message: 'Un créneau n’est plus disponible.' }
        : { status: 409, code: 'ITEM_UNAVAILABLE', message: 'Un article n’est plus disponible.' }, { quote: answer });
    }
    if (judged.needsDelivery && !judged.deliverAt) {
      return fail(res, req.body.deliverAt
        ? { status: 409, code: 'DELIVERY_TIME_UNAVAILABLE', message: 'Cette heure de livraison n’est plus possible.' }
        : invalid('Choisissez une heure de livraison.'), { quote: answer });
    }
    const ceiling = Number(maxOrderTotal()) || 500;
    if (priced.total > ceiling) return fail(res, limit(`Une commande ne dépasse pas ${labels.priceLabel(ceiling)}.`));
    const lines = snapshot(judged, priced.byKey, lang);
    const free = priced.total <= 0;
    if (!free && req.body.payment === 'none') return fail(res, invalid('Choisissez un mode de paiement.'));
    const mode = fulfilment();
    const delivery = { fulfilment: mode.mode, pickupPlace: mode.place };

    // Rules 25, 34 — a note or 0 € order: confirmed and written on the fiche in one transaction.
    if (free || req.body.payment === 'note') {
      let refusal = null;
      let order = null;
      let moved = [];
      try {
        db().transaction(() => {
          order = orders().create({
            reservationId: stay.id, sessionId, payment: free ? 'none' : 'note', status: 'confirmed',
            lines, total: priced.total, deliverAt: judged.deliverAt, ...delivery, clientKey, now: at,
          });
          const written = commit.commitOrder(stay.id, { ...orderNaming(order.id), lines: priced.lines });
          if (!written || written.status !== 200) {
            refusal = engineRefusal(written || { body: {} });
            throw refusal;
          }
          // Rule 35 — quoted after a card order awaiting payment, it adds less to the fiche than its quote: that order adds the rest.
          orders().setDeferred(order.id, Math.round(priced.total * 100) - Math.round(Number(written.total || 0) * 100));
          moved = countStock(stay.id, at);
        })();
      } catch (err) {
        if (clientKey && isUniqueClash(err)) return replay(res, orders().findByClientKey(sessionId, clientKey));
        if (err !== refusal) throw err;
        return fail(res, refusal);
      }
      alertStock(moved);
      notifyStaff(order);
      return publicHttp.ok(res, { orderId: order.id, status: 'confirmed' });
    }

    // Rule 33 — « Payer maintenant »: the order holds its slots while its link lives (rule 35).
    if (!paymentProviders.active()) return fail(res, { status: 409, code: 'CARD_UNAVAILABLE', message: 'Le paiement par carte est indisponible : ajoutez la commande à votre note.' });
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
      return fail(res, { status: (err && err.httpStatus) || 502, code: (err && err.error) || 'PAYMENT_UNAVAILABLE', message: (err && err.message) || 'Le paiement par carte est indisponible.' });
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
    const notices = [];
    if (order.status === 'awaiting_payment') notices.push(T.awaitingCard);
    if (order.status === 'paid_conflict') notices.push(T.conflict);
    if (order.deliverMoved && ['paid', 'confirmed'].includes(order.status)) notices.push(order.deliverAt ? T.moved(labels.momentLabel(order.deliverAt, lang)) : T.movedNone);
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
      statusLabel: labels.statusLabel(order, lang),
      ...(chip ? { deliveryLabel: chip } : {}),
      fulfilment: order.fulfilment === 'pickup' ? 'pickup' : 'delivery',
      promise: promised.promise,
      ...(promised.extraPromises.length ? { extraPromises: promised.extraPromises } : {}),
      movedNotice: promised.movedNotice,
      ...(notices.length ? { notices } : {}),
      // Rule 35 — an abandoned order's lines go back in the cart.
      ...(order.status === 'abandoned' ? { cartLines: order.lines.map(cartLineOf) } : {}),
    };
  }

  function cartLineOf(line) {
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
  const notFound = (res) => publicHttp.fail(res, 404, 'ORDER_NOT_FOUND', 'Commande introuvable.');

  // §4.3 — when each link was last read at the provider for the return page.
  const refreshedAt = new Map();

  /** `GET /orders/:id` — the return page polls it; an unpaid card order reads its link at the provider, every 10 s at most. */
  async function read(req, res) {
    let order = ownOrder(req);
    if (!order) return notFound(res);
    const at = now().getTime();
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
    if (order.status !== 'awaiting_payment') return publicHttp.fail(res, 409, 'ORDER_NOT_PENDING', 'Cette commande n’attend plus de paiement.');
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
        resourceId: Number(line.id), propertyId: stay.propertyId, stay, sessions: line.sessions, now: at, canIgnite,
      });
      return Boolean(verdict && verdict.ok);
    });
  }

  const commitLinesOf = (order) => order.lines.map(cartLineOf);

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
