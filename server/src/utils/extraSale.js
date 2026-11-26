/**
 * extraSale — the one write path for an extra on a stay that exists (specs/pricing/pricing-components.md §3 rules 27-30, 39, 37, 23).
 *
 *   quote(reservationId, requests, { payment, now, source })  → { status: 200, lines, buckets, totalCents, refusals } | { status, body }   writes nothing
 *   sell(reservationId, requests, { source, payment, actor, now, acceptedTotalCents, atArrival })  → { status: 200, saleDetail } | { status, body }
 *        `atArrival`: an unpaid re-sale routed to the arrival complement whatever the clock (guest-app rule 110 a, the SAS's change of an order)
 *   changeLine(reservationId, ref, patch, { now, forceOverpayment })  → { status: 200, saleDetail } | { status, body }
 *   removeLine(reservationId, ref, { now, actor })  → { status: 200, saleDetail } | { status, body }   an unpaid line taken off the stay
 *   collectionOf(reservationId, now)  → `arrival` | `departure` | `closed`: where a sale taken now is collected (rules 20, 104)
 *   saleDetailOf(reservationId, now)  → the payload of rule 31 (utils/saleDetail.js)
 *   departureSalesOf(reservationId, now)  → the arrival SAS's « Ventes du séjour — au départ » section, or null
 *   paidSalesOf(reservationId, now)       → the departure SAS's « Déjà payé » section (the lines already collected), or null
 *   unmarkArrival(reservationId, now)     → the check-in box unticked: a false start undone (rule 103) → { undone }
 *
 * A request is `{ articleRef: 'option:<id>' | 'resource:<id>', quantity, persons?, mornings?, time?, sessions? }`, or a line that is no article —
 * linen pieces, a plugin's supplement — `{ articleRef: 'custom', label, amount, quantity?, fulfilmentRef? }` (`amount` = the line's TTC total in euros;
 * `fulfilmentRef` = a stable key the seller reads the line back by). A sale is priced and
 * written exactly as the operator's « Enregistrer » writes it: the stored stay rebuilt as the fiche's PUT body, the requested lines added,
 * then `performUpdate(…, { sale: <seller> })` — the engine, the free allowances, the price lock, the arrival floors and the session conflicts are the
 * fiche's own, the nights read as stored and the stay's shape not judged (rules 8, 9), through the seller's named pipeline (rule 54: `ficheSale`,
 * `sasSale`, `shopSale`; the line gestures `changeLine` / `removeLine` are the fiche's, whichever screen calls the line API).
 * `quote` plays that save inside a rolled-back transaction; `sell` re-quotes inside its own and answers 409 `PRICE_CHANGED` when the price is
 * no longer the one accepted (rule 30). A stay that has not started takes the new line in its arrival complement (`inComplement`, rule 19);
 * a started one routes it by the extras baseline to the departure (rule 20). The line is stamped with its source, its moment and the
 * moment the clock gave (`collectAt`, `collectAtDefault`, rules 18, 46).
 *
 * A request for an article the stay already sells appends a NEW line (rules 13, 85): its own price (frozen once written, rule 74), source, moment
 * and status, numbered before it is priced; the lines already sold are not touched. `merged: true` stays for a breakfast, whose mornings join the stay's own.
 * `payment` is `later` (default), or `cash` / `card-terminal` / `card` for a sale collected at once (rule 29): the sale is written, then
 * settled as one mid-stay note that names its lines (`method`, `source`), so the allocations follow (rule 74). Only a stay that has
 * started takes a payment now (409 `PAYMENT_BEFORE_ARRIVAL`: before the check-in the money is the SAS's arrival complement, taken in
 * one piece); a stay whose departure complement is collected refuses it (« Séjour soldé »). The card link of the online-payment plugin
 * stays that plugin's (the platform card link is separate, rule 29).
 * A resource line placed on a planning names a fulfilment adapter (rule 49): `quote` lists a slot that is not free in `refusals`, `sell` confirms the
 * booking inside its transaction and answers 409 `SLOT_TAKEN` when it is gone.
 * Server-side money and labels only; the client renders what it gets.
 */
const {
  storedBody, optionRows, mergeOrderLines, personsRefusal, remainderByKey, deltaOf,
} = require('./stayOrderLines');
const { toCents, roundMoneyOrZero } = require('./pricing/money');
const { extraLineKey, numberedLabel, settledByKey, isPricedCustomLine } = require('./pricing/storedLines');
const { parseNotes } = require('./midStayExtras');
const { syncStay: syncAllocations } = require('./paymentAllocationsSync');
const {
  buildSaleDetail, stayOpenCents, departureSection, paidSection, arrivalComplementLines, partsText, PAID_TITLE,
} = require('./saleDetail');
const fulfilment = require('./pricing/articleFulfilment');
const { overpaidBy } = require('./pricing/refunds/basketOutcome');
const { makeArticle } = require('./pricing/articles');
const { nextLineId } = require('./lineRowTarget');
const { isArrivalValidated } = require('./pricing/stayClock');
const { PAID_LINE_REMOVED } = require('./paidLineJudgment');

const database = () => require('../database');
const reservations = () => require('../models/reservationsModel');
const controller = () => require('../controllers/reservationsController');
const extraSalesModel = () => require('../models/extraSalesModel');
const stayClock = () => require('../models/stayClockModel');
const events = () => require('../models/ports/eventPublisher');

const ROLLBACK = Symbol('extra-sale-rollback');
const SOURCES = ['fiche', 'shop', 'sas', 'intake', 'devis'];
// Rule 54 — the sale pipeline a source runs: the SAS and the shop have their own; an intake or a devis line is sold as the fiche sells it.
const salePipelineOf = (source) => (source === 'sas' || source === 'shop' ? source : 'fiche');
const MOMENTS = ['plan', 'platform', 'arrival', 'departure'];
const PAYMENTS = Object.freeze({ later: null, cash: { cash: true }, 'card-terminal': { cash: false }, card: { cash: false } });

const refuse = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });

// Rule 25 — a line that is no article (linen pieces, a plugin's supplement): its label and its TTC total are the request's, in cents' precision.
// Loop t18 O18-1 — judged by the engine's own predicate (`isPricedCustomLine`: a label and at least one cent): an amount under half a cent
// is refused here, instead of answering 200 for a line the engine drops and leaving a « Vente » history entry for a sale that wrote nothing.
function customRequest(request) {
  const label = String(request.label || '').trim();
  const amount = Number(request.amount);
  const quantity = request.quantity == null ? 1 : Number(request.quantity);
  if (!Number.isFinite(amount) || !isPricedCustomLine({ description: label, amount }) || !(quantity >= 1) || !Number.isInteger(quantity)) return null;
  // `fulfilmentRef` (loop t2 N-6): the stable key a seller gives the line (the guest app's evening supplement names its bath), read back by
  // that key, never by the label the line may have been numbered under (rule 94).
  const fulfilmentRef = typeof request.fulfilmentRef === 'string' && /^[a-z][\w:.-]{0,63}$/i.test(request.fulfilmentRef) ? request.fulfilmentRef : null;
  return { kind: 'custom', label, amount: toCents(amount) / 100, quantity, ...(fulfilmentRef ? { fulfilmentRef } : {}) };
}

function parseRequests(requests) {
  const lines = [];
  for (const request of Array.isArray(requests) ? requests : []) {
    if (request && request.articleRef === 'custom') {
      const custom = customRequest(request);
      if (!custom) return { error: refuse(400, 'INVALID_REQUEST', 'Libellé ou montant invalide.') };
      lines.push(custom);
      continue;
    }
    const match = /^(option|resource):([1-9]\d*)$/.exec(String(request && request.articleRef));
    const quantity = Number(request && request.quantity);
    if (!match || !(quantity > 0)) return { error: refuse(400, 'INVALID_REQUEST', 'Article ou quantité invalide.') };
    const id = Number(match[2]);
    if (match[1] === 'resource') lines.push({ kind: 'resource', id, quantity, sessions: request.sessions, ...(request.placeOnHeld ? { placeOnHeld: true } : {}) });
    else if (Array.isArray(request.mornings) && request.mornings.length) lines.push({ kind: 'breakfast', id, mornings: request.mornings, time: request.time, persons: Number(request.persons) || 1 });
    else lines.push({ kind: 'option', id, quantity, ...(request.noFreeUnits ? { noFreeUnits: true } : {}) });
  }
  return lines.length ? { lines } : { error: refuse(400, 'INVALID_REQUEST', 'Aucun article demandé.') };
}

// Rule 102 — the stay clock's answer (the lock, the payment taken now). Rule 103 — `carved`: where a line sold now is collected, the engine's
// own answer (`extrasCarvedOut`: the stay started, its arrival complement collected, or a baseline stored); the moment, the stamp, the routing,
// the moves and the sale detail read it, so the label and the bucket the money lands in never disagree.
const stayStarted = (reservationId, now) => {
  const phase = stayClock().phaseForReservation(reservationId, now);
  const started = Boolean(phase && phase.started);
  return { phase, started, carved: started || reservations().extrasCarvedOut(Number(reservationId)) };
};

// A stay not started takes a new line in its arrival complement (rule 19): every line the request appends is marked (a breakfast merged into the stay's own keeps its routing).
function withArrivalRouting(body) {
  const mark = (line) => (line.newLine ? { ...line, inComplement: 1 } : line);
  return {
    ...body, options: body.options.map(mark), resources: body.resources.map(mark), customOptions: (body.customOptions || []).map(mark),
  };
}

// Rule 49 — a resource line placed on a planning names a fulfilment adapter: its draft is the stay, the resource and the sessions asked.
// The app counts the bath's heat-up from the present moment (guest-app rule 79); the arrival SAS and the fiche keep the check-in.
function fulfilmentDrafts(reservationId, lines, now, { heatFromNow = false } = {}) {
  const row = database().prepare('SELECT propertyId, startDate, endDate, checkInTime, checkOutTime FROM reservations WHERE id = ?').get(Number(reservationId));
  if (!row) return [];
  const stay = { startDate: row.startDate, endDate: row.endDate, checkInTime: row.checkInTime, checkOutTime: row.checkOutTime };
  return lines.filter((line) => line.kind === 'resource' && Array.isArray(line.sessions) && line.sessions.length).map((line) => {
    const resource = database().prepare('SELECT * FROM resources WHERE id = ?').get(line.id);
    const id = resource ? fulfilment.fulfilmentOf(makeArticle(resource, { kind: 'resource' })) : null;
    return id ? {
      fulfilmentId: id, articleRef: `resource:${line.id}`, draft: {
        resourceId: line.id, propertyId: row.propertyId, stay, sessions: line.sessions, now, ...(heatFromNow ? { heatFrom: now } : {}),
      },
    } : null;
  }).filter(Boolean);
}

const refusalOf = (articleRef, refusal) => ({ articleRef, code: refusal.code, message: refusal.message });

function dryRunFor(reservationId, body, source, saleBase = null, { atArrival = false } = {}) {
  const result = controller().performUpdate(Number(reservationId), structuredClone(body), {
    dryRun: true, sale: salePipelineOf(source), saleBase, now: stayClock().gestureNow(), atArrival,
  });
  return result.status === 200 ? result : { refused: { status: result.status, body: result.body } };
}

// Rule 30 (owner 2026-11-15) — the stored stay as the engine of today prices it, before a gesture: the base the gesture's difference is taken from.
// The write adds that difference to the stored row (`saleBase`), so the stay moves by its line and nothing else.
function restatedBase(reservationId, source) {
  const stored = storedBody(Number(reservationId));
  if (!stored) return { refused: { status: 404, body: { error: 'Réservation introuvable', code: 'RESERVATION_NOT_FOUND' } } };
  return dryRunFor(reservationId, { ...stored, restatePricing: true }, source);
}

const centsOf = (row, field) => toCents(row && row[field]);

function bucketsDelta(before, after) {
  return {
    plan: centsOf(after, 'depositAmount') + centsOf(after, 'balanceAmount') - centsOf(before, 'depositAmount') - centsOf(before, 'balanceAmount'),
    arrival: centsOf(after, 'complementAmount') - centsOf(before, 'complementAmount'),
    departure: centsOf(after, 'endOfStayComplementAmount') - centsOf(before, 'endOfStayComplementAmount'),
  };
}

// A line that is no article is appended as the fiche appends one: its own text and amount, a line of its own (rule 13).
// A custom line is named by its label (`extraLineKey`): a second sale of a label the stay already holds takes a numbered label (« Bière locale (2) »),
// so its discount, its payment and its removal stay its own (rule 94).
function distinctLabel(customOptions, label) {
  return numberedLabel(label, new Set(customOptions.map((c) => extraLineKey({ isCustom: true, description: c.description }))));
}

function withCustomLine(body, line) {
  const customOptions = (body.customOptions || []).slice();
  customOptions.push({
    customKey: `sale_${customOptions.length + 1}`, description: distinctLabel(customOptions, line.label), amount: line.amount, offered: false, inComplement: 0, newLine: true,
  });
  return { ...body, customOptions };
}

// Rules 13, 74 (owner OD1 « sold lines kept ») — a line the stay already stores is kept whatever the catalogue says today; a NEW line is only sold
// of an article the lodging offers.
function unlinkedArticleRefusal(id, lines) {
  const row = database().prepare('SELECT propertyId FROM reservations WHERE id = ?').get(id);
  if (!row) return null;
  const catalogue = require('../models/ports/catalogueProvider').create(database());
  const options = new Set(catalogue.applicableOptions(row.propertyId).map((option) => Number(option.id)));
  const resources = new Set(catalogue.applicableResources(row.propertyId).map((resource) => Number(resource.id)));
  const missing = lines.find((line) => (line.kind === 'resource' ? !resources.has(line.id) : line.kind !== 'custom' && !options.has(line.id)));
  if (!missing) return null;
  return refuse(400, 'ARTICLE_NOT_OFFERED', 'Article non proposé pour ce logement.', { articleRef: `${missing.kind === 'resource' ? 'resource' : 'option'}:${missing.id}` });
}

// End-review V-7 — a stay whose arrival complement was typed by hand (`complementAmountOverride`) keeps that figure whatever its lines: money a gesture
// moves in the arrival complement would land nowhere (no bucket takes it). Such a gesture is refused until the hand-typed complement is cleared.
const COMPLEMENT_PINNED = 'Complément d’arrivée saisi à la main : le retirer d’abord.';
function complementPinnedRefusal(id) {
  const row = database().prepare('SELECT complementAmountOverride FROM reservations WHERE id = ?').get(Number(id));
  return row && row.complementAmountOverride != null ? refuse(409, 'COMPLEMENT_OVERRIDDEN', COMPLEMENT_PINNED) : null;
}

// Guest-app rule 110 a, rule 102 d — the arrival complement is still open at the door: the check-in hour has passed (or not yet), the arrival is
// not validated and its complement is not collected, and no baseline was laid otherwise.
const ARRIVAL_CLOSED = 'Arrivée déjà validée ou complément d’arrivée encaissé : la commande se règle au départ.';
// Loop t4 A4-1 — a stay whose false start was kept (a baseline stored, unticked before the hour): neither validated nor collected, its sales are
// already the departure's until the check-in hour.
const ARRIVAL_CARVED_EARLY = 'Les ventes de ce séjour se règlent déjà au départ : la commande aussi.';
// Loop t5 S5-6 — the validation is the stay clock's (rule 102): the check-in box or the committed SAS count from the arrival day only, so a box
// ticked days ahead closes nothing the sale still routes to the arrival.
function arrivalClosedRefusal(id, clock) {
  const row = database().prepare('SELECT complementPaid, complementPaidCash, checkInDone, arrivalSasDoneAt FROM reservations WHERE id = ?').get(Number(id));
  const validated = Boolean(row) && isArrivalValidated(row) && Boolean(clock.phase && clock.phase.arrivalDayReached);
  if (!row || Number(row.complementPaid || 0) === 1 || Number(row.complementPaidCash || 0) === 1 || validated) return refuse(409, 'ARRIVAL_CLOSED', ARRIVAL_CLOSED);
  return clock.carved && !clock.started ? refuse(409, 'ARRIVAL_CLOSED', ARRIVAL_CARVED_EARLY) : null;
}

// Guest-app rule 110 a, loop t4 A4-1 — the one judge of « an order taken before the arrival is still changed at the door »: the stay is live, its
// arrival neither validated nor collected, and the engine has not carved its extras out before the stay clock (a kept false start). The sale's
// `atArrival` refusal and the guest app's editable step both read it.
function arrivalOpenAtAt(reservationId, now = new Date()) {
  const id = Number(reservationId);
  if (collectionOfAt(id, now) === 'closed') return false;
  return !arrivalClosedRefusal(id, stayStarted(id, now));
}

function pricedRequests(reservationId, lines, { now, source, atArrival = false }) {
  const id = Number(reservationId);
  const stored = storedBody(id);
  if (!stored) return { error: refuse(404, 'RESERVATION_NOT_FOUND', 'Réservation introuvable') };
  const rows = optionRows(database(), lines);
  const persons = personsRefusal(stored, lines, rows);
  if (persons) return { error: persons };
  // guest-app rule 110 a — an order taken before the arrival, changed at the arrival SAS before the arrival is validated, is re-sold into the
  // arrival complement whatever the hour: the guest settles it at the door, never at the departure. Only while that complement is open
  // (rule 103): once the arrival is validated or its complement collected, the door collects nothing more and `atArrival` is refused.
  const clock = stayStarted(id, now);
  // Loop t5 S5-6 — the one judge: the sale refuses `atArrival` exactly when `arrivalOpenAt` reads the arrival closed.
  const closed = atArrival ? arrivalClosedRefusal(id, clock) : null;
  if (closed) return { error: closed };
  const started = atArrival ? false : clock.carved;
  const pinned = started ? null : complementPinnedRefusal(id);
  if (pinned) return { error: pinned };
  // Both prices are the engine's of today (`restatePricing`): a stay sold at a figure the engine no longer reproduces would otherwise read its whole drift as the
  // price of the line (guest-app rule 93). The sale is what the lines cost, never what the stay's price moved by — and what it writes is the stored stay plus
  // that difference (rule 30, owner 2026-11-15): the quote, the dry runs and the write all pin on `saleBase`.
  const refusal = unlinkedArticleRefusal(id, lines);
  if (refusal) return { error: refusal };
  const base = dryRunFor(id, { ...stored, restatePricing: true }, source);
  if (base.refused) return { error: base.refused };
  const storedRow = reservations().getRow(id);
  let body = stored;
  let previous = storedRow;
  const priced = [];
  const held = (b) => b.options.length + b.resources.length + (b.customOptions || []).length;
  for (const line of lines) {
    const before = held(body);
    body = line.kind === 'custom' ? withCustomLine(body, line) : mergeOrderLines(body, [line], rows, (table) => nextLineId(database(), table));
    const routed = started ? body : withArrivalRouting(body);
    const next = dryRunFor(id, routed, source, base.row, { atArrival });
    if (next.refused) return { error: next.refused };
    priced.push({
      line,
      merged: held(body) === before,
      totalCents: centsOf(next.row, 'finalPrice') - centsOf(previous, 'finalPrice'),
    });
    previous = next.row;
  }
  const finalBody = started ? body : withArrivalRouting(body);
  return {
    stored, body: finalBody, base: storedRow, saleBase: base.row, after: previous, priced, started, clockStarted: clock.started, atArrival,
  };
}

// What the stay already holds of the article, said by the server: its lines keep their own price (rule 13), a breakfast completes the stay's own.
function soldBeforeNote(reservationId, line, merged) {
  const table = line.kind === 'resource' ? 'reservation_resources' : 'reservation_options';
  const column = line.kind === 'resource' ? 'resourceId' : 'optionId';
  const rows = database().prepare(`SELECT quantity, unitPrice FROM ${table} WHERE reservationId = ? AND ${column} = ? ORDER BY lineId`).all(Number(reservationId), line.id);
  if (!rows.length) return null;
  if (merged) return 'Déjà vendu sur ce séjour : les matinées s’ajoutent au petit-déjeuner du séjour.';
  return `Déjà vendu sur ce séjour : ${partsText(rows.map((row) => ({ quantity: row.quantity, unitCents: toCents(row.unitPrice) })))}. Ces lignes gardent leur prix.`;
}

// Rule 30 (loop t4 S4-4) — the buckets as the sale writes them: paid now, what the sale added to the departure remainder is settled by its note in the
// same transaction (`settleNow`), so the departure bucket does not move.
function quotedBuckets(result, payment) {
  const buckets = bucketsDelta(result.base, result.after);
  if (!PAYMENTS[payment]) return buckets;
  return { ...buckets, departure: buckets.departure - toCents(deltaOf(remainderByKey(result.base), remainderByKey(result.after)).total) };
}

function quoteAt(reservationId, requests, {
  payment = 'later', now = new Date(), source = 'fiche', atArrival = false,
} = {}) {
  if (!(payment in PAYMENTS)) return refuse(400, 'PAYMENT_MODE_UNSUPPORTED', 'Mode de paiement inconnu.');
  const parsed = parseRequests(requests);
  if (parsed.error) return parsed.error;
  // The numbers the quote gives its lines are only taken inside a transaction that is rolled back: a quote writes nothing.
  let result = null;
  try {
    database().transaction(() => {
      result = pricedRequests(reservationId, parsed.lines, { now, source, atArrival: atArrival && !PAYMENTS[payment] });
      throw ROLLBACK;
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  if (result.error) return result.error;
  // Rule 30 — the quote refuses what the sale would refuse before pricing: a payment taken now on a settled stay, or before the arrival.
  if (PAYMENTS[payment] && departureCollected(Number(reservationId))) return refuse(409, 'STAY_SETTLED', 'Séjour soldé : vente séparée.');
  if (PAYMENTS[payment] && !result.clockStarted) return refuse(409, 'PAYMENT_BEFORE_ARRIVAL', 'Avant l’arrivée, le paiement se prend au SAS.');
  const moment = result.started ? 'departure' : 'arrival';
  const refusals = fulfilmentDrafts(reservationId, parsed.lines, now, { heatFromNow: source === 'shop' })
    .map(({ fulfilmentId, articleRef, draft }) => ({ articleRef, outcome: fulfilment.reserve(fulfilmentId, draft) }))
    .filter(({ outcome }) => outcome.refusal)
    .map(({ articleRef, outcome }) => refusalOf(articleRef, outcome.refusal));
  return {
    status: 200,
    lines: result.priced.map(({ line, totalCents, merged }) => ({
      articleRef: line.kind === 'custom' ? 'custom' : `${line.kind === 'resource' ? 'resource' : 'option'}:${line.id}`, totalCents, merged, collectAt: moment,
      momentLabel: moment === 'departure' ? 'À payer au départ' : 'À payer à l’arrivée',
      note: line.kind === 'custom' ? null : soldBeforeNote(reservationId, line, merged),
    })),
    buckets: quotedBuckets(result, payment),
    totalCents: centsOf(result.after, 'finalPrice') - centsOf(result.base, 'finalPrice'),
    refusals,
  };
}

function sellAt(reservationId, requests, {
  source = 'fiche', payment = 'later', actor = null, now = new Date(), acceptedTotalCents = null, orderRef = null, paid = null, within = null, history = null,
  atArrival = false,
} = {}) {
  if (!SOURCES.includes(source)) return refuse(400, 'INVALID_SOURCE', 'Origine de vente inconnue.');
  if (!(payment in PAYMENTS)) return refuse(400, 'PAYMENT_MODE_UNSUPPORTED', 'Mode de paiement inconnu.');
  const parsed = parseRequests(requests);
  if (parsed.error) return parsed.error;
  const db = database();
  const id = Number(reservationId);
  let outcome = null;
  let soldLines = [];
  try {
    db.transaction(() => {
      if (PAYMENTS[payment] && departureCollected(id)) { outcome = refuse(409, 'STAY_SETTLED', 'Séjour soldé : vente séparée.'); throw ROLLBACK; }
      const result = pricedRequests(id, parsed.lines, { now, source, atArrival: atArrival && !PAYMENTS[payment] && !paid });
      if (result.error) { outcome = result.error; throw ROLLBACK; }
      if (PAYMENTS[payment] && !result.clockStarted && !paid) {
        outcome = refuse(409, 'PAYMENT_BEFORE_ARRIVAL', 'Avant l’arrivée, le paiement se prend au SAS.');
        throw ROLLBACK;
      }
      const total = centsOf(result.after, 'finalPrice') - centsOf(result.base, 'finalPrice');
      if (acceptedTotalCents != null && Number(acceptedTotalCents) !== total) {
        outcome = refuse(409, 'PRICE_CHANGED', 'Prix modifié — relire le panier.', { totalCents: total });
        throw ROLLBACK;
      }
      // Rule 29 (the shop's card path) — the money received cannot be less than what the sale now costs: a price that rose is not honoured.
      if (paid && total > Number(paid.amountCents || 0)) {
        outcome = refuse(409, 'PRICE_ROSE', 'Le prix de la commande a augmenté avant le paiement.', { totalCents: total });
        throw ROLLBACK;
      }
      // Rule 49 — the booking the line needs is confirmed in this transaction, before the line exists: a taken slot refuses the sale.
      for (const { fulfilmentId, articleRef, draft } of fulfilmentDrafts(id, parsed.lines, now, { heatFromNow: source === 'shop' })) {
        const held = fulfilment.reserve(fulfilmentId, draft);
        const confirmed = held.refusal ? held : fulfilment.confirm(fulfilmentId, held.hold, draft, null);
        if (confirmed.refusal) {
          outcome = refuse(409, confirmed.refusal.code, confirmed.refusal.message, { articleRef });
          throw ROLLBACK;
        }
      }
      const before = extraSalesModel().lineIds(id);
      const factsBefore = paid && !result.started ? lineFactsOf(id) : null;
      const written = controller().performUpdate(id, result.body, {
        sale: salePipelineOf(source), saleBase: result.saleBase, now, atArrival: result.atArrival,
      });
      if (written.status !== 200) { outcome = { status: written.status, body: written.body }; throw ROLLBACK; }
      const moment = result.started ? 'departure' : 'arrival';
      const ref = typeof orderRef === 'function' ? orderRef() : orderRef;
      const noAllowance = new Set((result.body.options || []).filter((line) => line.noFreeUnits && line.lineId != null).map((line) => Number(line.lineId)));
      const added = extraSalesModel().stampNewLines(id, before, {
        source, collectAt: moment, soldAt: now.toISOString(), orderRef: ref, noAllowance,
      });
      extraSalesModel().stampCustomQuantities(id, added, parsed.lines.filter((line) => line.kind === 'custom'));
      reservations().addHistoryEntry(id, 'update', [(typeof history === 'function' ? history() : history) || {
        field: 'extraSale', label: 'Vente', from: null, to: `${added.length ? added.map((line) => line.label).join(', ') : 'Ligne complétée'} — ${source}${actor ? ` (${actor})` : ''}`,
      }]);
      let money = { settledCents: 0, overpaidCents: 0 };
      if (paid) {
        const byKey = result.started ? deltaOf(remainderByKey(result.base), remainderByKey(reservations().getRow(id))).byKey : null;
        money = settleCard(id, added, {
          ...paid, source: paid.source || source, ref: paid.ref || ref, started: result.started, now, byKey, grown: factsBefore ? grownLines(factsBefore, lineFactsOf(id)) : [],
        });
        if (money.error) { outcome = money.error; throw ROLLBACK; }
      } else if (PAYMENTS[payment]) {
        const settled = settleNow(id, deltaOf(remainderByKey(result.base), remainderByKey(reservations().getRow(id))).byKey, { source, payment, now });
        if (settled.error) { outcome = settled.error; throw ROLLBACK; }
      }
      outcome = {
        status: 200,
        saleDetail: saleDetailOf(id, now),
        totalCents: total,
        collectAt: moment,
        ...(ref ? { orderRef: ref } : {}),
        lines: result.priced.map(({ line, totalCents, merged }) => ({ articleRef: line.kind === 'custom' ? 'custom' : `${line.kind === 'resource' ? 'resource' : 'option'}:${line.id}`, totalCents, merged })),
        ...money,
      };
      soldLines = added.map((line) => ({ label: line.label }));
      if (typeof within === 'function') within(outcome);
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  // Rule 55 — after the commit: the guest e-mail, the calendar and the staff push are observers, never part of the sale.
  if (outcome && outcome.status === 200) {
    const sold = new Set(soldLines.map((line) => line.label));
    const lines = outcome.saleDetail.lines.filter((line) => sold.has(line.label))
      .map((line) => ({ ref: line.ref, label: line.label, totalCents: line.totalCents, collectAt: line.collectAt }));
    events().publish('extraSale.sold', {
      reservationId: id, source, lines, ...(outcome.orderRef ? { orderRef: outcome.orderRef } : {}),
    });
  }
  return outcome;
}

// Rule 29, amended for the shop card path (owner Q-C3) — the card money collects the sale's lines at once, line by line up to what was paid:
// one settled note naming them (the engine reads it net, rules 21 and 31). A stay that has started takes the note the fiche's own way (the end-of-stay
// remainder moves into it); before the arrival the note names the lines the arrival complement carries. → `{ settledCents, overpaidCents }`.
function settleCard(id, added, {
  amountCents, paidDate = null, reference = null, source, ref, started, now, byKey, grown = [],
}) {
  const detail = saleDetailOf(id, now);
  let left = Number(amountCents || 0);
  const items = [];
  // Before the arrival: the lines the sale appended, and a line it completed (a breakfast morning merged into the stay's breakfast line, rule 96) by what it grew.
  const due = started
    ? Object.entries(byKey).map(([key, amount]) => ({ key, label: null, cents: toCents(amount) }))
    : [...added.map((line) => {
      const sold = detail.lines.find((candidate) => candidate.ref === `${line.kind}:${line.lineId}`);
      return { key: extraSalesModel().keyOfLine(id, line.kind, line.lineId), label: line.label, cents: sold ? Number(sold.totalCents) : 0 };
    }), ...grown];
  for (const line of due) {
    const take = Math.min(left, line.cents);
    if (take <= 0) continue;
    items.push({ key: line.key, ...(line.label ? { label: line.label } : {}), amount: take / 100 });
    left -= take;
  }
  if (!items.length) return { settledCents: 0, overpaidCents: overpaidBy(left, 0) };
  // Guest-app rules 35, 108 — before the arrival the card money is netted out of the stored arrival complement in the same transaction: the SAS, the
  // bucket states and a complement link read the row, and the guest is never asked a second time for what the card paid.
  const base = started ? null : restatedBase(id, source);
  if (base && base.refused) return { error: base.refused };
  const note = started
    ? reservations().settleMidStayNote(id, { items, cash: false })
    : extraSalesModel().writeCardNote(id, { items });
  const db = database();
  const notes = parseNotes(db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(id).midStaySettledNotes)
    .map((n) => (Number(n.id) === Number(note.id)
      ? {
        ...n, ...(paidDate ? { paidDate } : {}), source, ref: String(ref || ''), method: 'card', soldAt: now.toISOString(), ...(reference ? { reference: String(reference) } : {}),
      }
      : n));
  db.prepare("UPDATE reservations SET midStaySettledNotes = ?, updatedAt = datetime('now') WHERE id = ?").run(JSON.stringify(notes), id);
  if (base) {
    const netted = controller().performUpdate(id, { ...storedBody(id), restatePricing: true }, { sale: salePipelineOf(source), saleBase: base.row, now });
    if (netted.status !== 200) return { error: { status: netted.status, body: netted.body } };
  }
  syncAllocations(db, id);
  return { settledCents: toCents(note.total), overpaidCents: overpaidBy(left, 0) };
}

const lineFactsOf = (id) => require('../models/ports/stayRepository').create(database()).lineFacts(id);

// The stored lines a write completed rather than appended: same key, a stored amount that grew → [{ key, label, cents }].
function grownLines(before, after) {
  return Object.entries(after)
    .filter(([key, fact]) => before[key] && fact.storedCents != null && fact.storedCents > Number(before[key].storedCents || 0))
    .map(([key, fact]) => {
      const named = database().prepare(`SELECT o.title AS label FROM reservation_options ro JOIN options o ON o.id = ro.optionId WHERE ro.lineId = ?`).get(Number(fact.lineId));
      return { key, label: named ? String(named.label) : null, cents: fact.storedCents - Number(before[key].storedCents || 0) };
    });
}

function departureCollected(id) {
  const row = database().prepare('SELECT endOfStayComplementPaid, endOfStayComplementPaidCash FROM reservations WHERE id = ?').get(id);
  return Boolean(row) && (Number(row.endOfStayComplementPaid || 0) === 1 || Number(row.endOfStayComplementPaidCash || 0) === 1);
}

// Rule 29 — the sale collected at once: one settled mid-stay note naming the sale's lines, in the sale's transaction.
function settleNow(id, byKey, { source, payment, now }) {
  const items = Object.entries(byKey).map(([key, amount]) => ({ key, amount }));
  if (!items.length) return {};
  let note;
  try {
    note = reservations().settleMidStayNote(id, { items, cash: PAYMENTS[payment].cash });
  } catch (err) {
    if (err.code) return { error: refuse(409, err.code, err.message) };
    throw err;
  }
  const db = database();
  const notes = parseNotes(db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(id).midStaySettledNotes)
    .map((n) => (Number(n.id) === Number(note.id) ? { ...n, source, method: payment, soldAt: now.toISOString() } : n));
  db.prepare("UPDATE reservations SET midStaySettledNotes = ?, updatedAt = datetime('now') WHERE id = ?").run(JSON.stringify(notes), id);
  syncAllocations(db, id);
  return {};
}

// Loop t4 S4-6 — the stored end-of-stay remainder by line key, in cents (the mid-stay lines of the detail).
function departureRemainderByKey(row) {
  const byKey = {};
  for (const [key, amount] of remainderByKey(row)) byKey[key] = toCents(amount);
  return byKey;
}

function saleDetailOfAt(reservationId, now = new Date()) {
  const id = Number(reservationId);
  const db = database();
  const row = reservations().getRow(id);
  if (!row) return null;
  const { quoteStoredReservation } = require('./storedReservationQuote');
  const quote = quoteStoredReservation(db, row);
  if (!quote || quote.error) return null;
  const { create } = require('../models/ports/stayRepository');
  const facts = create(db).lineFacts(id);
  const clock = stayStarted(id, now);
  const { phase } = clock;
  const { isDirectChannel } = require('./platformNameFormat');
  const arrivalCollected = Number(row.complementPaid || 0) === 1 || Number(row.complementPaidCash || 0) === 1;
  // Rule 91 — the tax part and the added guests the arrival complement collects, read where every e-mail reads them.
  const arrival = reservations().buildArrivalComplementDetail(id, { includeOffered: true }).detail || [];
  const taxLine = arrival.find((line) => line.kind === 'tax');
  const guestsLine = arrival.find((line) => line.kind === 'extraGuests');
  return buildSaleDetail({
    quote, facts, phase: phase ? phase.phase : null, platformStay: !isDirectChannel(row.platform),
    // Rule 103 — the moments the engine routes a line to now: the arrival only before it carves the extras out, the departure once it does, the
    // arrival too while its complement is not collected.
    moments: clock.carved ? (arrivalCollected ? ['departure'] : ['arrival', 'departure']) : ['arrival'],
    beforeClock: !clock.started,
    vatClassOf: (line, kind) => extraSalesModel().vatClassOf(line, kind),
    stored: {
      finalCents: toCents(row.finalPrice),
      touristTaxCents: toCents(row.touristTaxTotal),
      planCents: toCents(row.depositAmount) + toCents(row.balanceAmount),
      arrivalCents: toCents(row.complementAmount),
      departureCents: toCents(row.endOfStayComplementAmount),
      touristTaxArrivalCents: taxLine ? toCents(taxLine.amount) : 0,
      touristTaxArrivalLabel: taxLine ? taxLine.label : null,
      extraGuestsCents: guestsLine ? toCents(guestsLine.offered ? guestsLine.originalAmount : guestsLine.amount) : 0,
      extraGuestsOffered: Boolean(guestsLine && guestsLine.offered),
      extraGuestsCount: guestsLine ? guestsLine.qty : 0,
      departureByKey: departureRemainderByKey(row),
      // Loop t5 S5-3 — what the notes paid on each line key, for the rule-104 credit lines.
      paidByKey: Object.fromEntries(Object.entries(settledByKey(row.midStaySettledNotes)).map(([key, amount]) => [key, toCents(amount)])),
      // Rule 106 c — the panel's « Reste à payer »: the register's « Reste à percevoir » of the stored fiche.
      openCents: stayOpenCents(row),
    },
  });
}

// Rule 91 — the arrival complement the guest e-mails list, read from the sale detail: `{ amount, paid, detail }` like
// `buildArrivalComplementDetail`, which stays the reading of a stay the engine cannot quote (null here).
// specs/payments/direct-installments.md rule 58 — what the plan's installments do not cover is not an anonymous « Complément d'arrivée »: it
// takes its own line out of the adjustment, so the e-mails and the SAS name it the same way.
function withInstallmentRest(lines, row) {
  const at = lines.findIndex((line) => line.kind === 'remainder');
  if (at < 0) return lines;
  const rest = require('./installmentPlan').restOfPlan(row, lines[at].amount);
  if (!(rest > 0)) return lines;
  const { INSTALLMENT_REST_LABEL } = require('./pricing/settlement');
  const left = roundMoneyOrZero(lines[at].amount - rest);
  const restLine = { kind: 'installmentRest', label: INSTALLMENT_REST_LABEL, qty: 1, unitPrice: rest, amount: rest };
  const remainder = left > 0.01 ? [{ ...lines[at], unitPrice: left, amount: left }] : [];
  return [...lines.slice(0, at), restLine, ...remainder, ...lines.slice(at + 1)];
}

function arrivalComplementDetailOfAt(reservationId, now = new Date()) {
  const detail = saleDetailOf(reservationId, now);
  if (!detail) return null;
  const row = reservations().getRow(Number(reservationId));
  const { ADDED_GUESTS_TAX_LABEL } = require('./platformPaidGuests');
  const paid = Number(row.complementPaid || 0) === 1 ? 1 : 0;
  return {
    amount: detail.buckets.arrival / 100,
    paid,
    detail: withInstallmentRest(arrivalComplementLines(detail, { addedGuestsTaxLabel: ADDED_GUESTS_TAX_LABEL, complementPaid: paid === 1 }), row),
  };
}

// Rule 95 — before the stay has started, a line is collected at the arrival or in the plan: the extras baseline that carves a line out to the departure
// is the started stay's (rule 20), and one laid before the arrival would carve out every later sale, then vanish at the boot repair.
const BEFORE_ARRIVAL_DEPARTURE = 'Avant l’arrivée, une vente se paie à l’arrivée.';

// The fiche's save refuses a lowered arrival line with the wording of a removal; a move says it is a move that is refused.
const MOVE_REFUSED = 'Cette ligne ne peut pas changer de moment : elle a été vendue à l’arrivée.';
function moveRefusal(restated) {
  const body = restated.body || {};
  return body.code === 'ARRIVAL_EXTRAS_FROZEN'
    ? { status: 409, body: { ...body, error: MOVE_REFUSED, code: 'MOMENT_NOT_AVAILABLE' } }
    : { status: restated.status, body };
}

// Rules 37, 39, 23 — what the operator changes on one stored line. The line is addressed by `ref` (`option:<lineId>`, `resource:<lineId>`, `custom:<lineId>`).
function changeLineAt(reservationId, ref, patch, { now = new Date(), forceOverpayment = false } = {}) {
  const id = Number(reservationId);
  const model = extraSalesModel();
  const line = model.findLine(id, ref);
  if (!line) return refuse(404, 'LINE_NOT_FOUND', 'Ligne introuvable');
  const wants = patch || {};
  const touched = ['collectAt', 'discount', 'offered'].filter((field) => wants[field] !== undefined);
  if (!touched.length) return refuse(400, 'INVALID_REQUEST', 'Aucun changement demandé.');
  const db = database();
  let outcome = null;
  let movedTo = null;
  let owedCents = 0;
  try {
    db.transaction(() => {
      if (wants.collectAt !== undefined) {
        // Rule 103 — a stay whose extras the engine carves out (started, arrival complement collected, a baseline stored) moves a line by its
        // baseline; any other is before the arrival and moves by its routing only (rule 95).
        const clock = stayStarted(id, now);
        const started = clock.carved;
        // Loop t4 S4-5 — the refusal of rule 95 reads the stay clock: a stay whose extras are carved out before its arrival (an early complement)
        // moves to the departure only a line the sale stamped there (and back).
        const refusal = model.momentRefusal(id, line, wants.collectAt, MOMENTS)
          || (wants.collectAt === 'arrival' || line.collectAt === 'arrival' ? complementPinnedRefusal(id) : null)
          || (!clock.started && wants.collectAt === 'departure' && line.collectAt !== 'departure' && !(started && line.collectAtDefault === 'departure')
            ? refuse(409, 'MOMENT_NOT_AVAILABLE', BEFORE_ARRIVAL_DEPARTURE) : null);
        if (refusal) { outcome = refusal; throw ROLLBACK; }
        const base = restatedBase(id, 'fiche');
        if (base.refused) { outcome = moveRefusal(base.refused); throw ROLLBACK; }
        const moved = model.moveLine(id, line, wants.collectAt, { started });
        if (moved) {
          movedTo = wants.collectAt;
          const restated = controller().performUpdate(id, { ...storedBody(id), restatePricing: true }, { sale: 'fiche', saleBase: base.row, now });
          if (restated.status !== 200) { outcome = moveRefusal(restated); throw ROLLBACK; }
          reservations().addHistoryEntry(id, 'update', [{
            field: 'lineMoment', label: line.label, from: moved.fromLabel, to: moved.toLabel,
          }]);
        }
      }
      if (wants.discount !== undefined || wants.offered !== undefined) {
        const pinned = line.collectAt === 'arrival' ? complementPinnedRefusal(id) : null;
        if (pinned) { outcome = pinned; throw ROLLBACK; }
        const base = restatedBase(id, 'fiche');
        if (base.refused) { outcome = base.refused; throw ROLLBACK; }
        const lowered = model.lowerLine(id, line, wants);
        if (lowered.error) { outcome = lowered.error; throw ROLLBACK; }
        // The fiche's own save judges it (rule 23, O-10): a paid line lowered is refused 409 OVERPAID until `forceOverpayment`, the
        // confirmed excess opens the `lineLowered` obligation there, and rule 104's 409 LINE_PAID (money nothing absorbs on a platform stay)
        // is that save's too (`utils/paidLineJudgment`, loop t5 S5-1) — one formula, one place, whichever screen saved.
        const owedBefore = model.openLoweredCents(id);
        const restated = controller().performUpdate(id, { ...lowered.body, restatePricing: true, forceOverpayment: Boolean(forceOverpayment) }, { sale: 'fiche', saleBase: base.row, unpaidLine: !lowered.paidLine, now });
        if (restated.status !== 200) { outcome = { status: restated.status, body: restated.body }; throw ROLLBACK; }
        model.storeDiscount(line, lowered.discountCents, { arrivalOpen: arrivalOpenAtAt(id, now) });
        owedCents = model.openLoweredCents(id) - owedBefore;
        reservations().addHistoryEntry(id, 'update', [{ field: 'lineLowered', label: line.label, from: null, to: lowered.text }]);
      }
      outcome = { status: 200, saleDetail: saleDetailOf(id, now) };
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  if (outcome && outcome.status === 200) {
    if (movedTo) events().publish('extraSale.lineMoved', { reservationId: id, ref, from: line.collectAt || null, to: movedTo });
    if (owedCents > 0) events().publish('extraSale.refundOwed', { reservationId: id, ref, cents: owedCents });
  }
  return outcome;
}

// Rules 25, 26 — an unpaid line taken off the stay through the fiche's own save: the engine re-prices the stay under its price lock, gives the
// line's free units back to the pool (`releaseAllowance`) and keeps its refusals (a line sold at an arrival already collected stays, 409).
// A paid line is offered, never removed (rule 23: the money it carries stays credited until a refund).
function removeLineAt(reservationId, ref, { now = new Date(), actor = null } = {}) {
  const id = Number(reservationId);
  const model = extraSalesModel();
  const line = model.findLine(id, ref);
  if (!line) return refuse(404, 'LINE_NOT_FOUND', 'Ligne introuvable');
  // Loop t5 S5-4 — judged by what the notes paid on the line, not by its allocations: an offered paid line holds none and stays the note's.
  if (line.settledCents > 0 || line.paidCents > 0) return refuse(409, 'LINE_PAID', PAID_LINE_REMOVED);
  const body = storedBody(id);
  if (!body) return refuse(404, 'RESERVATION_NOT_FOUND', 'Réservation introuvable');
  const pinned = line.collectAt === 'arrival' ? complementPinnedRefusal(id) : null;
  if (pinned) return pinned;
  const db = database();
  let outcome = null;
  try {
    db.transaction(() => {
      const base = restatedBase(id, 'fiche');
      if (base.refused) { outcome = base.refused; throw ROLLBACK; }
      const restated = controller().performUpdate(id, { ...model.withoutLine(body, line), restatePricing: true }, { sale: 'fiche', saleBase: base.row, unpaidLine: true, now });
      if (restated.status !== 200) { outcome = { status: restated.status, body: restated.body }; throw ROLLBACK; }
      reservations().addHistoryEntry(id, 'update', [{
        field: 'lineRemoved', label: line.label, from: `${(line.totalCents / 100).toFixed(2).replace('.', ',')} €`, to: `retirée${actor ? ` (${actor})` : ''}`,
      }]);
      outcome = { status: 200, saleDetail: saleDetailOf(id, now) };
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return outcome;
}

// What the stay still owes back for lines the operator lowered after they were paid (rule 23), carried by the SAS sections so the SAS announces
// the figure and the fiche pays it (mock M3).
const withRefundOwed = (section, reservationId) => (section ? { ...section, refundOwedCents: extraSalesModel().openLoweredCents(Number(reservationId)) } : section);

// The SAS's own section of what the stay sold for its departure (rule 32).
// Rules 20, 104, 103 — where an order taken now is collected: `departure` once the engine carves the stay's extras out (the stay clock reached the
// arrival, the arrival complement is collected, a baseline is stored), else `arrival`; `closed` when the end-of-stay complement is collected or the
// stay is not a live reservation. The one judge of the shop, the e-mail flags and the sale.
function collectionOfAt(reservationId, now = new Date()) {
  const id = Number(reservationId);
  const row = reservations().getRow(id);
  if (!row || String(row.kind || 'reservation') !== 'reservation' || departureCollected(id)) return 'closed';
  return stayStarted(id, now).carved ? 'departure' : 'arrival';
}

// Rule 103 — the check-in box unticked before the check-in hour undoes the false start it made (rule 102 a): while the arrival was marked, the
// engine laid a baseline and carved what was sold out to the departure. Once unticked, the stay is before its arrival again, so — when nothing was
// collected in between (no complement, no note of the stay) — those lines go back to the arrival, the baseline goes, and the stored complements
// follow in the same pinned write (rule 93). Otherwise — or when the arrival complement is the operator's own amount (loop t4 S4-2) — the
// baseline stays, and the sale keeps reading it (`extrasCarvedOut`). → `{ undone }`.
function unmarkArrivalAt(reservationId, now = new Date()) {
  const id = Number(reservationId);
  const db = database();
  let undone = false;
  db.transaction(() => {
    const row = reservations().getRow(id);
    if (!row) return;
    const wasMarked = Number(row.checkInDone || 0) === 1;
    const base = wasMarked && row.arrivalExtrasBaseline && !row.arrivalSasDoneAt ? restatedBase(id, 'fiche') : null;
    db.prepare("UPDATE reservations SET checkInDone = 0, updatedAt = datetime('now') WHERE id = ?").run(id);
    syncAllocations(db, id);
    if (!base || base.refused) return;
    const after = reservations().getRow(id);
    const collected = [after.complementPaid, after.complementPaidCash, after.endOfStayComplementPaid, after.endOfStayComplementPaidCash].some((flag) => Number(flag || 0) === 1);
    const notes = parseNotes(after.midStaySettledNotes).filter((note) => note && !note.beforeArrival);
    // Loop t4 S4-2 — a complement the operator forced (COMPLEMENT_OVERRIDDEN) takes no line back: the carved lines keep their departure money.
    if (stayStarted(id, now).started || collected || notes.length || complementPinnedRefusal(id)) return;
    const moved = [];
    for (const { table, label } of [
      { table: 'reservation_options', label: 'SELECT o.title AS label FROM reservation_options ro JOIN options o ON o.id = ro.optionId WHERE ro.lineId = ?' },
      { table: 'reservation_resources', label: 'SELECT r.name AS label FROM reservation_resources rr JOIN resources r ON r.id = rr.resourceId WHERE rr.lineId = ?' },
      { table: 'reservation_custom_options', label: 'SELECT description AS label FROM reservation_custom_options WHERE lineId = ?' },
    ]) {
      for (const line of db.prepare(`SELECT lineId FROM ${table} WHERE reservationId = ? AND collectAt = 'departure'`).all(id)) {
        db.prepare(`UPDATE ${table} SET collectAt = 'arrival', inComplement = 1 WHERE lineId = ?`).run(line.lineId);
        const named = db.prepare(label).get(line.lineId);
        moved.push(named ? named.label : 'Prestation');
      }
    }
    db.prepare("UPDATE reservations SET arrivalExtrasBaseline = NULL, updatedAt = datetime('now') WHERE id = ?").run(id);
    const restated = controller().performUpdate(id, { ...storedBody(id), restatePricing: true }, { sale: 'fiche', saleBase: base.row, now });
    if (restated.status !== 200) throw Object.assign(new Error(restated.body && restated.body.error), { status: restated.status, body: restated.body });
    if (moved.length) {
      reservations().addHistoryEntry(id, 'update', [{
        field: 'lineMoment', label: moved.join(', '), from: 'à payer au départ (arrivée cochée)', to: 'à payer à l’arrivée (arrivée décochée)',
      }]);
    }
    syncAllocations(db, id);
    undone = true;
  })();
  return { undone };
}

function departureSalesOfAt(reservationId, now = new Date()) {
  return withRefundOwed(departureSection(saleDetailOf(reservationId, now)), reservationId);
}

// The departure SAS's section of what the stay already collected on its sold lines (rule 32).
function paidSalesOfAt(reservationId, now = new Date()) {
  const owed = extraSalesModel().openLoweredCents(Number(reservationId));
  const section = paidSection(saleDetailOf(reservationId, now)) || (owed > 0 ? { title: PAID_TITLE, lines: [], groups: [], totalCents: 0, dueCents: 0 } : null);
  return withRefundOwed(section, reservationId);
}

// Rule 102 — one moment per gesture: the `now` a caller injects is the one every reader the gesture reaches sees (the lock, the extras window,
// the baseline, the detail), never the wall clock.
const nowOf = (options) => (options && options.now) || new Date();
const quote = (reservationId, requests, options = {}) => stayClock().withNow(nowOf(options), () => quoteAt(reservationId, requests, { ...options, now: nowOf(options) }));
const sell = (reservationId, requests, options = {}) => stayClock().withNow(nowOf(options), () => sellAt(reservationId, requests, { ...options, now: nowOf(options) }));
const changeLine = (reservationId, ref, patch, options = {}) => stayClock().withNow(nowOf(options), () => changeLineAt(reservationId, ref, patch, { ...options, now: nowOf(options) }));
const removeLine = (reservationId, ref, options = {}) => stayClock().withNow(nowOf(options), () => removeLineAt(reservationId, ref, { ...options, now: nowOf(options) }));
const atMoment = (fn) => (reservationId, now = stayClock().gestureNow()) => stayClock().withNow(now, () => fn(reservationId, now));
const collectionOf = atMoment(collectionOfAt);
const saleDetailOf = atMoment(saleDetailOfAt);
const arrivalComplementDetailOf = atMoment(arrivalComplementDetailOfAt);
const departureSalesOf = atMoment(departureSalesOfAt);
const paidSalesOf = atMoment(paidSalesOfAt);
const unmarkArrival = atMoment(unmarkArrivalAt);
const arrivalOpenAt = atMoment(arrivalOpenAtAt);

module.exports = {
  __test: { withInstallmentRest },
  quote, sell, changeLine, removeLine, collectionOf, saleDetailOf, arrivalComplementDetailOf, departureSalesOf, paidSalesOf, parseRequests, unmarkArrival,
  arrivalOpenAt,
};
