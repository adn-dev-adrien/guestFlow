/**
 * extraSale — the one write path for an extra on a stay that exists (specs/pricing-components.md §3 rules 27-30, 39, 37, 23).
 *
 *   quote(reservationId, requests, { payment, now })  → { status: 200, lines, buckets, totalCents, refusals } | { status, body }   writes nothing
 *   sell(reservationId, requests, { source, payment, actor, now, acceptedTotalCents })  → { status: 200, saleDetail } | { status, body }
 *   changeLine(reservationId, ref, patch, { now, forceOverpayment })  → { status: 200, saleDetail } | { status, body }
 *   saleDetailOf(reservationId, now)  → the payload of rule 31 (utils/saleDetail.js)
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
 * Only `payment: 'later'` is written here: a payment taken at once belongs to the SAS (rule 29).
 * Server-side money and labels only; the client renders what it gets.
 */
const { storedBody, optionRows, mergeOrderLines, personsRefusal } = require('./midStayOrderCommit');
const { toCents } = require('./pricing/money');
const { buildSaleDetail } = require('./saleDetail');

const database = () => require('../database');
const reservations = () => require('../models/reservationsModel');
const controller = () => require('../controllers/reservationsController');
const extraSalesModel = () => require('../models/extraSalesModel');
const stayClock = () => require('../models/stayClockModel');

const ROLLBACK = Symbol('extra-sale-rollback');
const SOURCES = ['fiche', 'shop', 'sas', 'intake', 'devis'];
const MOMENTS = ['plan', 'platform', 'arrival', 'departure'];

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
  if (payment !== 'later') return refuse(400, 'PAYMENT_MODE_UNSUPPORTED', 'Le paiement immédiat se prend au SAS.');
  const parsed = parseRequests(requests);
  if (parsed.error) return parsed.error;
  const result = pricedRequests(reservationId, parsed.lines, { now });
  if (result.error) return result.error;
  const moment = result.started ? 'departure' : 'arrival';
  return {
    status: 200,
    lines: result.priced.map(({ line, totalCents, merged }) => ({
      articleRef: `${line.kind === 'resource' ? 'resource' : 'option'}:${line.id}`, totalCents, merged, collectAt: moment,
      momentLabel: moment === 'departure' ? 'À payer au départ' : 'À payer à l’arrivée',
    })),
    buckets: bucketsDelta(result.base, result.after),
    totalCents: centsOf(result.after, 'finalPrice') - centsOf(result.base, 'finalPrice'),
    refusals: [],
  };
}

function sell(reservationId, requests, { source = 'fiche', payment = 'later', actor = null, now = new Date(), acceptedTotalCents = null } = {}) {
  if (!SOURCES.includes(source)) return refuse(400, 'INVALID_SOURCE', 'Origine de vente inconnue.');
  if (payment !== 'later') return refuse(400, 'PAYMENT_MODE_UNSUPPORTED', 'Le paiement immédiat se prend au SAS.');
  const parsed = parseRequests(requests);
  if (parsed.error) return parsed.error;
  const db = database();
  const id = Number(reservationId);
  let outcome = null;
  try {
    db.transaction(() => {
      const result = pricedRequests(id, parsed.lines, { now });
      if (result.error) { outcome = result.error; throw ROLLBACK; }
      const total = centsOf(result.after, 'finalPrice') - centsOf(result.base, 'finalPrice');
      if (acceptedTotalCents != null && Number(acceptedTotalCents) !== total) {
        outcome = refuse(409, 'PRICE_CHANGED', 'Prix modifié — relire le panier.', { totalCents: total });
        throw ROLLBACK;
      }
      const before = extraSalesModel().lineIds(id);
      const written = controller().performUpdate(id, result.body);
      if (written.status !== 200) { outcome = { status: written.status, body: written.body }; throw ROLLBACK; }
      const moment = result.started ? 'departure' : 'arrival';
      const added = extraSalesModel().stampNewLines(id, before, { source, collectAt: moment, soldAt: now.toISOString() });
      reservations().addHistoryEntry(id, 'update', [{
        field: 'extraSale', label: 'Vente', from: null, to: `${added.length ? added.map((line) => line.label).join(', ') : 'Ligne complétée'} — ${source}${actor ? ` (${actor})` : ''}`,
      }]);
      outcome = { status: 200, saleDetail: saleDetailOf(id, now) };
    })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  return outcome;
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

module.exports = { quote, sell, changeLine, saleDetailOf, parseRequests };
