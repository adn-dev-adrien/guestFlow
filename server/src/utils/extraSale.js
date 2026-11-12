/**
 * extraSale — the one write path for an extra on a stay that exists (specs/pricing-components.md §3 rules 27-30, 39, 37, 23).
 *
 *   quote(reservationId, requests, { payment, now })  → { status: 200, lines, buckets, totalCents, refusals } | { status, body }   writes nothing
 *   sell(reservationId, requests, { source, payment, actor, now, acceptedTotalCents })  → { status: 200, saleDetail } | { status, body }
 *   changeLine(reservationId, ref, patch, { now, forceOverpayment })  → { status: 200, saleDetail } | { status, body }
 *   saleDetailOf(reservationId, now)  → the payload of rule 31 (utils/saleDetail.js)
 *   departureSalesOf(reservationId, now)  → the SAS's « Ventes du séjour — au départ » section, or null
 *
 * A request is `{ articleRef: 'option:<id>' | 'resource:<id>', quantity, persons?, mornings?, time?, sessions? }`. A sale is priced and
 * written exactly as the operator's « Enregistrer » writes it: the stored stay rebuilt as the fiche's PUT body, the requested lines added,
 * then `performUpdate` — the engine, the free allowances, the price lock, the arrival floors and the session conflicts are the fiche's own.
 * `quote` plays that save inside a rolled-back transaction; `sell` re-quotes inside its own and answers 409 `PRICE_CHANGED` when the price is
 * no longer the one accepted (rule 30). A stay that has not started takes the new line in its arrival complement (`inComplement`, rule 19);
 * a started one routes it by the extras baseline to the departure (rule 20). The line is stamped with its source, its moment and the
 * moment the clock gave (`collectAt`, `collectAtDefault`, rules 18, 46).
 *
 * Until PR C lifts the one-line-per-article key, a request for an article the stay already sells adds to that line (`merged: true`).
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
} = require('./midStayOrderCommit');
const { toCents } = require('./pricing/money');
const { parseNotes } = require('./midStayExtras');
const { syncStay: syncAllocations } = require('./paymentAllocationsSync');
const { buildSaleDetail, departureSection } = require('./saleDetail');
const fulfilment = require('./pricing/articleFulfilment');
const { makeArticle } = require('./pricing/articles');

const database = () => require('../database');
const reservations = () => require('../models/reservationsModel');
const controller = () => require('../controllers/reservationsController');
const extraSalesModel = () => require('../models/extraSalesModel');
const stayClock = () => require('../models/stayClockModel');

const ROLLBACK = Symbol('extra-sale-rollback');
const SOURCES = ['fiche', 'shop', 'sas', 'intake', 'devis'];
const MOMENTS = ['plan', 'platform', 'arrival', 'departure'];
const PAYMENTS = Object.freeze({ later: null, cash: { cash: true }, 'card-terminal': { cash: false }, card: { cash: false } });

const refuse = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });

function parseRequests(requests) {
  const lines = [];
  for (const request of Array.isArray(requests) ? requests : []) {
    const match = /^(option|resource):([1-9]\d*)$/.exec(String(request && request.articleRef));
    const quantity = Number(request && request.quantity);
    if (!match || !(quantity > 0)) return { error: refuse(400, 'INVALID_REQUEST', 'Article ou quantité invalide.') };
    const id = Number(match[2]);
    if (match[1] === 'resource') lines.push({ kind: 'resource', id, quantity, sessions: request.sessions });
    else if (Array.isArray(request.mornings) && request.mornings.length) lines.push({ kind: 'breakfast', id, mornings: request.mornings, time: request.time, persons: Number(request.persons) || 1 });
    else lines.push({ kind: 'option', id, quantity });
  }
  return lines.length ? { lines } : { error: refuse(400, 'INVALID_REQUEST', 'Aucun article demandé.') };
}

const stayStarted = (reservationId, now) => {
  const phase = stayClock().phaseForReservation(reservationId, now);
  return { phase, started: Boolean(phase && phase.started) };
};

// A stay not started takes a new line in its arrival complement (rule 19): every line the request adds is marked, the ones it merges into keep their routing.
function withArrivalRouting(body, stored, lines) {
  const options = body.options.map((line) => (stored.options.some((s) => Number(s.optionId) === Number(line.optionId)) ? line : { ...line, inComplement: 1 }));
  const resources = body.resources.map((line) => (stored.resources.some((s) => Number(s.resourceId) === Number(line.resourceId)) ? line : { ...line, inComplement: 1 }));
  return { ...body, options, resources };
}

// Rule 49 — a resource line placed on a planning names a fulfilment adapter: its draft is the stay, the resource and the sessions asked.
function fulfilmentDrafts(reservationId, lines, now) {
  const row = database().prepare('SELECT propertyId, startDate, endDate, checkInTime, checkOutTime FROM reservations WHERE id = ?').get(Number(reservationId));
  if (!row) return [];
  const stay = { startDate: row.startDate, endDate: row.endDate, checkInTime: row.checkInTime, checkOutTime: row.checkOutTime };
  return lines.filter((line) => line.kind === 'resource' && Array.isArray(line.sessions) && line.sessions.length).map((line) => {
    const resource = database().prepare('SELECT * FROM resources WHERE id = ?').get(line.id);
    const id = resource ? fulfilment.fulfilmentOf(makeArticle(resource, { kind: 'resource' })) : null;
    return id ? {
      fulfilmentId: id, articleRef: `resource:${line.id}`, draft: { resourceId: line.id, propertyId: row.propertyId, stay, sessions: line.sessions, now },
    } : null;
  }).filter(Boolean);
}

const refusalOf = (articleRef, refusal) => ({ articleRef, code: refusal.code, message: refusal.message });

function dryRunFor(reservationId, body) {
  const result = controller().performUpdate(Number(reservationId), structuredClone(body), { dryRun: true });
  return result.status === 200 ? result : { refused: { status: result.status, body: result.body } };
}

const centsOf = (row, field) => toCents(row && row[field]);

function bucketsDelta(before, after) {
  return {
    plan: centsOf(after, 'depositAmount') + centsOf(after, 'balanceAmount') - centsOf(before, 'depositAmount') - centsOf(before, 'balanceAmount'),
    arrival: centsOf(after, 'complementAmount') - centsOf(before, 'complementAmount'),
    departure: centsOf(after, 'endOfStayComplementAmount') - centsOf(before, 'endOfStayComplementAmount'),
  };
}

function pricedRequests(reservationId, lines, { now }) {
  const id = Number(reservationId);
  const stored = storedBody(id);
  if (!stored) return { error: refuse(404, 'RESERVATION_NOT_FOUND', 'Réservation introuvable') };
  const rows = optionRows(database(), lines);
  const persons = personsRefusal(stored, lines, rows);
  if (persons) return { error: persons };
  const { started } = stayStarted(id, now);
  const base = dryRunFor(id, stored);
  if (base.refused) return { error: base.refused };
  let body = stored;
  let previous = base.row;
  const priced = [];
  for (const line of lines) {
    body = mergeOrderLines(body, [line], rows);
    const routed = started ? body : withArrivalRouting(body, stored, lines);
    const next = dryRunFor(id, routed);
    if (next.refused) return { error: next.refused };
    priced.push({
      line,
      merged: stored[line.kind === 'resource' ? 'resources' : 'options'].some((s) => Number(s.optionId ?? s.resourceId) === Number(line.id)),
      totalCents: centsOf(next.row, 'finalPrice') - centsOf(previous, 'finalPrice'),
    });
    previous = next.row;
  }
  const finalBody = started ? body : withArrivalRouting(body, stored, lines);
  return { stored, body: finalBody, base: base.row, after: previous, priced, started };
}

function quote(reservationId, requests, { payment = 'later', now = new Date() } = {}) {
  if (!(payment in PAYMENTS)) return refuse(400, 'PAYMENT_MODE_UNSUPPORTED', 'Mode de paiement inconnu.');
  const parsed = parseRequests(requests);
  if (parsed.error) return parsed.error;
  const result = pricedRequests(reservationId, parsed.lines, { now });
  if (result.error) return result.error;
  const moment = result.started ? 'departure' : 'arrival';
  const refusals = fulfilmentDrafts(reservationId, parsed.lines, now)
    .map(({ fulfilmentId, articleRef, draft }) => ({ articleRef, outcome: fulfilment.reserve(fulfilmentId, draft) }))
    .filter(({ outcome }) => outcome.refusal)
    .map(({ articleRef, outcome }) => refusalOf(articleRef, outcome.refusal));
  return {
    status: 200,
    lines: result.priced.map(({ line, totalCents, merged }) => ({
      articleRef: `${line.kind === 'resource' ? 'resource' : 'option'}:${line.id}`, totalCents, merged, collectAt: moment,
      momentLabel: moment === 'departure' ? 'À payer au départ' : 'À payer à l’arrivée',
    })),
    buckets: bucketsDelta(result.base, result.after),
    totalCents: centsOf(result.after, 'finalPrice') - centsOf(result.base, 'finalPrice'),
    refusals,
  };
}

function sell(reservationId, requests, { source = 'fiche', payment = 'later', actor = null, now = new Date(), acceptedTotalCents = null } = {}) {
  if (!SOURCES.includes(source)) return refuse(400, 'INVALID_SOURCE', 'Origine de vente inconnue.');
  if (!(payment in PAYMENTS)) return refuse(400, 'PAYMENT_MODE_UNSUPPORTED', 'Mode de paiement inconnu.');
  const parsed = parseRequests(requests);
  if (parsed.error) return parsed.error;
  const db = database();
  const id = Number(reservationId);
  let outcome = null;
  try {
    db.transaction(() => {
      if (PAYMENTS[payment] && departureCollected(id)) { outcome = refuse(409, 'STAY_SETTLED', 'Séjour soldé : vente séparée.'); throw ROLLBACK; }
      const result = pricedRequests(id, parsed.lines, { now });
      if (result.error) { outcome = result.error; throw ROLLBACK; }
      if (PAYMENTS[payment] && !result.started) {
        outcome = refuse(409, 'PAYMENT_BEFORE_ARRIVAL', 'Avant l’arrivée, le paiement se prend au SAS.');
        throw ROLLBACK;
      }
      const total = centsOf(result.after, 'finalPrice') - centsOf(result.base, 'finalPrice');
      if (acceptedTotalCents != null && Number(acceptedTotalCents) !== total) {
        outcome = refuse(409, 'PRICE_CHANGED', 'Prix modifié — relire le panier.', { totalCents: total });
        throw ROLLBACK;
      }
      // Rule 49 — the booking the line needs is confirmed in this transaction, before the line exists: a taken slot refuses the sale.
      for (const { fulfilmentId, articleRef, draft } of fulfilmentDrafts(id, parsed.lines, now)) {
        const held = fulfilment.reserve(fulfilmentId, draft);
        const confirmed = held.refusal ? held : fulfilment.confirm(fulfilmentId, held.hold, draft, null);
        if (confirmed.refusal) {
          outcome = refuse(409, confirmed.refusal.code, confirmed.refusal.message, { articleRef });
          throw ROLLBACK;
        }
      }
      const before = extraSalesModel().lineIds(id);
      const written = controller().performUpdate(id, result.body);
      if (written.status !== 200) { outcome = { status: written.status, body: written.body }; throw ROLLBACK; }
      const moment = result.started ? 'departure' : 'arrival';
      const added = extraSalesModel().stampNewLines(id, before, { source, collectAt: moment, soldAt: now.toISOString() });
      reservations().addHistoryEntry(id, 'update', [{
        field: 'extraSale', label: 'Vente', from: null, to: `${added.length ? added.map((line) => line.label).join(', ') : 'Ligne complétée'} — ${source}${actor ? ` (${actor})` : ''}`,
      }]);
      if (PAYMENTS[payment]) {
        const paid = settleNow(id, deltaOf(remainderByKey(result.base), remainderByKey(reservations().getRow(id))).byKey, { source, payment, now });
        if (paid.error) { outcome = paid.error; throw ROLLBACK; }
      }
      outcome = { status: 200, saleDetail: saleDetailOf(id, now) };
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return outcome;
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

function saleDetailOf(reservationId, now = new Date()) {
  const id = Number(reservationId);
  const db = database();
  const row = reservations().getRow(id);
  if (!row) return null;
  const { quoteStoredReservation } = require('./storedReservationQuote');
  const quote = quoteStoredReservation(db, row);
  if (!quote || quote.error) return null;
  const { create } = require('../models/ports/stayRepository');
  const facts = create(db).lineFacts(id);
  const phase = stayClock().phaseForReservation(id, now);
  const { isDirectChannel } = require('./platformNameFormat');
  return buildSaleDetail({
    quote, facts, phase: phase ? phase.phase : null, platformStay: !isDirectChannel(row.platform),
    vatClassOf: (line, kind) => extraSalesModel().vatClassOf(line, kind),
  });
}

// Rules 37, 39, 23 — what the operator changes on one stored line. The line is addressed by `ref` (`option:<lineId>`, `resource:<lineId>`, `custom:<lineId>`).
function changeLine(reservationId, ref, patch, { now = new Date(), forceOverpayment = false } = {}) {
  const id = Number(reservationId);
  const model = extraSalesModel();
  const line = model.findLine(id, ref);
  if (!line) return refuse(404, 'LINE_NOT_FOUND', 'Ligne introuvable');
  const wants = patch || {};
  const touched = ['collectAt', 'discount', 'offered'].filter((field) => wants[field] !== undefined);
  if (!touched.length) return refuse(400, 'INVALID_REQUEST', 'Aucun changement demandé.');
  const db = database();
  let outcome = null;
  try {
    db.transaction(() => {
      if (wants.collectAt !== undefined) {
        const refusal = model.momentRefusal(id, line, wants.collectAt, MOMENTS);
        if (refusal) { outcome = refusal; throw ROLLBACK; }
        const moved = model.moveLine(id, line, wants.collectAt);
        if (moved) {
          const restated = controller().performUpdate(id, { ...storedBody(id), restatePricing: true });
          if (restated.status !== 200) { outcome = { status: restated.status, body: restated.body }; throw ROLLBACK; }
          reservations().addHistoryEntry(id, 'update', [{
            field: 'lineMoment', label: line.label, from: moved.fromLabel, to: moved.toLabel,
          }]);
        }
      }
      if (wants.discount !== undefined || wants.offered !== undefined) {
        const lowered = model.lowerLine(id, line, wants);
        if (lowered.error) { outcome = lowered.error; throw ROLLBACK; }
        // The fiche's own save judges it (rule 23, O-10): a paid line lowered is refused 409 OVERPAID until `forceOverpayment`, and the
        // confirmed excess opens the `lineLowered` obligation there — one formula, one place.
        const restated = controller().performUpdate(id, { ...lowered.body, restatePricing: true, forceOverpayment: Boolean(forceOverpayment) });
        if (restated.status !== 200) { outcome = { status: restated.status, body: restated.body }; throw ROLLBACK; }
        model.storeDiscount(line, lowered.discountCents);
        reservations().addHistoryEntry(id, 'update', [{ field: 'lineLowered', label: line.label, from: null, to: lowered.text }]);
      }
      outcome = { status: 200, saleDetail: saleDetailOf(id, now) };
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return outcome;
}

// The SAS's own section of what the stay sold for its departure (rule 32).
function departureSalesOf(reservationId, now = new Date()) {
  return departureSection(saleDetailOf(reservationId, now));
}

module.exports = {
  quote, sell, changeLine, saleDetailOf, departureSalesOf, parseRequests,
};
