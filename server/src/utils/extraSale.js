/**
 * extraSale — the one write path for an extra on a stay that exists (specs/pricing-components.md §3 rules 27-30, 39, 37, 23).
 *
 *   quote(reservationId, requests, { payment, now, source })  → { status: 200, lines, buckets, totalCents, refusals } | { status, body }   writes nothing
 *   sell(reservationId, requests, { source, payment, actor, now, acceptedTotalCents })  → { status: 200, saleDetail } | { status, body }
 *   changeLine(reservationId, ref, patch, { now, forceOverpayment })  → { status: 200, saleDetail } | { status, body }
 *   removeLine(reservationId, ref, { now, actor })  → { status: 200, saleDetail } | { status, body }   an unpaid line taken off the stay
 *   collectionOf(reservationId, now)  → `arrival` | `departure` | `closed`: where a sale taken now is collected (rules 20, 104)
 *   saleDetailOf(reservationId, now)  → the payload of rule 31 (utils/saleDetail.js)
 *   departureSalesOf(reservationId, now)  → the arrival SAS's « Ventes du séjour — au départ » section, or null
 *   paidSalesOf(reservationId, now)       → the departure SAS's « Déjà payé » section (the lines already collected), or null
 *
 * A request is `{ articleRef: 'option:<id>' | 'resource:<id>', quantity, persons?, mornings?, time?, sessions? }`, or a line that is no article —
 * linen pieces, a plugin's supplement — `{ articleRef: 'custom', label, amount, quantity? }` (`amount` = the line's TTC total in euros). A sale is priced and
 * written exactly as the operator's « Enregistrer » writes it: the stored stay rebuilt as the fiche's PUT body, the requested lines added,
 * then `performUpdate` — the engine, the free allowances, the price lock, the arrival floors and the session conflicts are the fiche's own.
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
const { toCents } = require('./pricing/money');
const { parseNotes } = require('./midStayExtras');
const { syncStay: syncAllocations } = require('./paymentAllocationsSync');
const {
  buildSaleDetail, departureSection, paidSection, arrivalComplementLines, partsText, PAID_TITLE,
} = require('./saleDetail');
const fulfilment = require('./pricing/articleFulfilment');
const { overpaidBy } = require('./pricing/refunds/basketOutcome');
const { makeArticle } = require('./pricing/articles');
const { nextLineId } = require('./lineRowTarget');

const database = () => require('../database');
const reservations = () => require('../models/reservationsModel');
const controller = () => require('../controllers/reservationsController');
const extraSalesModel = () => require('../models/extraSalesModel');
const stayClock = () => require('../models/stayClockModel');
const events = () => require('../models/ports/eventPublisher');

const ROLLBACK = Symbol('extra-sale-rollback');
const SOURCES = ['fiche', 'shop', 'sas', 'intake', 'devis'];
const MOMENTS = ['plan', 'platform', 'arrival', 'departure'];
const PAYMENTS = Object.freeze({ later: null, cash: { cash: true }, 'card-terminal': { cash: false }, card: { cash: false } });

const refuse = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });

// Rule 25 — a line that is no article (linen pieces, a plugin's supplement): its label and its TTC total are the request's, in cents' precision.
function customRequest(request) {
  const label = String(request.label || '').trim();
  const amount = Number(request.amount);
  const quantity = request.quantity == null ? 1 : Number(request.quantity);
  if (!label || !(amount > 0) || !Number.isFinite(amount) || !(quantity >= 1) || !Number.isInteger(quantity)) return null;
  return { kind: 'custom', label, amount: toCents(amount) / 100, quantity };
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

const stayStarted = (reservationId, now) => {
  const phase = stayClock().phaseForReservation(reservationId, now);
  return { phase, started: Boolean(phase && phase.started) };
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

// A line that is no article is appended as the fiche appends one: its own text and amount, a line of its own (rule 13).
function withCustomLine(body, line) {
  const customOptions = (body.customOptions || []).slice();
  customOptions.push({
    customKey: `sale_${customOptions.length + 1}`, description: line.label, amount: line.amount, offered: false, inComplement: 0, newLine: true,
  });
  return { ...body, customOptions };
}

function pricedRequests(reservationId, lines, { now }) {
  const id = Number(reservationId);
  const stored = storedBody(id);
  if (!stored) return { error: refuse(404, 'RESERVATION_NOT_FOUND', 'Réservation introuvable') };
  const rows = optionRows(database(), lines);
  const persons = personsRefusal(stored, lines, rows);
  if (persons) return { error: persons };
  const { started } = stayStarted(id, now);
  // Both prices are the engine's of today (`restatePricing`): a stay sold at a figure the engine no longer reproduces would otherwise read its whole drift as the
  // price of the line (guest-app rule 93). The sale is what the lines cost, never what the stay's price moved by.
  const base = dryRunFor(id, { ...stored, restatePricing: true });
  if (base.refused) return { error: base.refused };
  let body = stored;
  let previous = base.row;
  const priced = [];
  const held = (b) => b.options.length + b.resources.length + (b.customOptions || []).length;
  for (const line of lines) {
    const before = held(body);
    body = line.kind === 'custom' ? withCustomLine(body, line) : mergeOrderLines(body, [line], rows, (table) => nextLineId(database(), table));
    const routed = started ? body : withArrivalRouting(body);
    const next = dryRunFor(id, routed);
    if (next.refused) return { error: next.refused };
    priced.push({
      line,
      merged: held(body) === before,
      totalCents: centsOf(next.row, 'finalPrice') - centsOf(previous, 'finalPrice'),
    });
    previous = next.row;
  }
  const finalBody = started ? body : withArrivalRouting(body);
  return { stored, body: finalBody, base: base.row, after: previous, priced, started };
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

function quote(reservationId, requests, {
  payment = 'later', now = new Date(), source = 'fiche',
} = {}) {
  if (!(payment in PAYMENTS)) return refuse(400, 'PAYMENT_MODE_UNSUPPORTED', 'Mode de paiement inconnu.');
  const parsed = parseRequests(requests);
  if (parsed.error) return parsed.error;
  // The numbers the quote gives its lines are only taken inside a transaction that is rolled back: a quote writes nothing.
  let result = null;
  try {
    database().transaction(() => { result = pricedRequests(reservationId, parsed.lines, { now }); throw ROLLBACK; })();
  } catch (err) {
    if (err !== ROLLBACK) throw err;
  }
  if (result.error) return result.error;
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
    buckets: bucketsDelta(result.base, result.after),
    totalCents: centsOf(result.after, 'finalPrice') - centsOf(result.base, 'finalPrice'),
    refusals,
  };
}

function sell(reservationId, requests, {
  source = 'fiche', payment = 'later', actor = null, now = new Date(), acceptedTotalCents = null, orderRef = null, paid = null, within = null, history = null,
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
      const result = pricedRequests(id, parsed.lines, { now });
      if (result.error) { outcome = result.error; throw ROLLBACK; }
      if (PAYMENTS[payment] && !result.started && !paid) {
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
      const written = controller().performUpdate(id, result.body);
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
          ...paid, source: paid.source || source, ref: paid.ref || ref, started: result.started, now, byKey,
        });
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
  amountCents, paidDate = null, reference = null, source, ref, started, now, byKey,
}) {
  const detail = saleDetailOf(id, now);
  let left = Number(amountCents || 0);
  const items = [];
  const due = started
    ? Object.entries(byKey).map(([key, amount]) => ({ key, label: null, cents: toCents(amount) }))
    : added.map((line) => {
      const sold = detail.lines.find((candidate) => candidate.ref === `${line.kind}:${line.lineId}`);
      return { key: extraSalesModel().keyOfLine(id, line.kind, line.lineId), label: line.label, cents: sold ? Number(sold.totalCents) : 0 };
    });
  for (const line of due) {
    const take = Math.min(left, line.cents);
    if (take <= 0) continue;
    items.push({ key: line.key, ...(line.label ? { label: line.label } : {}), amount: take / 100 });
    left -= take;
  }
  if (!items.length) return { settledCents: 0, overpaidCents: overpaidBy(left, 0) };
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
  syncAllocations(db, id);
  return { settledCents: toCents(note.total), overpaidCents: overpaidBy(left, 0) };
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
  // Rule 91 — the tax part and the added guests the arrival complement collects, read where every e-mail reads them.
  const arrival = reservations().buildArrivalComplementDetail(id, { includeOffered: true }).detail || [];
  const taxLine = arrival.find((line) => line.kind === 'tax');
  const guestsLine = arrival.find((line) => line.kind === 'extraGuests');
  return buildSaleDetail({
    quote, facts, phase: phase ? phase.phase : null, platformStay: !isDirectChannel(row.platform),
    vatClassOf: (line, kind) => extraSalesModel().vatClassOf(line, kind),
    stored: {
      finalCents: toCents(row.finalPrice),
      touristTaxCents: toCents(row.touristTaxTotal),
      touristTaxArrivalCents: taxLine ? toCents(taxLine.amount) : 0,
      touristTaxArrivalLabel: taxLine ? taxLine.label : null,
      extraGuestsCents: guestsLine ? toCents(guestsLine.offered ? guestsLine.originalAmount : guestsLine.amount) : 0,
      extraGuestsOffered: Boolean(guestsLine && guestsLine.offered),
      extraGuestsCount: guestsLine ? guestsLine.qty : 0,
    },
  });
}

// Rule 91 — the arrival complement the guest e-mails list, read from the sale detail: `{ amount, paid, detail }` like
// `buildArrivalComplementDetail`, which stays the reading of a stay the engine cannot quote (null here).
function arrivalComplementDetailOf(reservationId, now = new Date()) {
  const detail = saleDetailOf(reservationId, now);
  if (!detail) return null;
  const row = reservations().getRow(Number(reservationId));
  const { ADDED_GUESTS_TAX_LABEL } = require('./platformPaidGuests');
  return {
    amount: detail.buckets.arrival / 100,
    paid: Number(row.complementPaid || 0) === 1 ? 1 : 0,
    detail: arrivalComplementLines(detail, { addedGuestsTaxLabel: ADDED_GUESTS_TAX_LABEL }),
  };
}

// The fiche's save refuses a lowered arrival line with the wording of a removal; a move says it is a move that is refused.
const MOVE_REFUSED = 'Cette ligne ne peut pas changer de moment : elle a été vendue à l’arrivée.';
function moveRefusal(restated) {
  const body = restated.body || {};
  return body.code === 'ARRIVAL_EXTRAS_FROZEN'
    ? { status: 409, body: { ...body, error: MOVE_REFUSED, code: 'MOMENT_NOT_AVAILABLE' } }
    : { status: restated.status, body };
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
  let movedTo = null;
  let owedCents = 0;
  try {
    db.transaction(() => {
      if (wants.collectAt !== undefined) {
        const refusal = model.momentRefusal(id, line, wants.collectAt, MOMENTS);
        if (refusal) { outcome = refusal; throw ROLLBACK; }
        const moved = model.moveLine(id, line, wants.collectAt);
        if (moved) {
          movedTo = wants.collectAt;
          const restated = controller().performUpdate(id, { ...storedBody(id), restatePricing: true });
          if (restated.status !== 200) { outcome = moveRefusal(restated); throw ROLLBACK; }
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
        const owedBefore = model.openLoweredCents(id);
        const restated = controller().performUpdate(id, { ...lowered.body, restatePricing: true, forceOverpayment: Boolean(forceOverpayment) });
        if (restated.status !== 200) { outcome = { status: restated.status, body: restated.body }; throw ROLLBACK; }
        model.storeDiscount(line, lowered.discountCents);
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
function removeLine(reservationId, ref, { now = new Date(), actor = null } = {}) {
  const id = Number(reservationId);
  const model = extraSalesModel();
  const line = model.findLine(id, ref);
  if (!line) return refuse(404, 'LINE_NOT_FOUND', 'Ligne introuvable');
  if (line.settledCents > 0) return refuse(409, 'LINE_PAID', 'Ligne déjà payée : elle peut être offerte, pas retirée.');
  const body = storedBody(id);
  if (!body) return refuse(404, 'RESERVATION_NOT_FOUND', 'Réservation introuvable');
  const db = database();
  let outcome = null;
  try {
    db.transaction(() => {
      const restated = controller().performUpdate(id, { ...model.withoutLine(body, line), restatePricing: true });
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
// Rules 20, 104 — where an order taken now is collected: `arrival` while the stay clock has not reached the arrival, `departure` once it has,
// `closed` when the end-of-stay complement is collected or the stay is not a live reservation. The one judge of the shop, the e-mail flags and the sale.
function collectionOf(reservationId, now = new Date()) {
  const id = Number(reservationId);
  const row = reservations().getRow(id);
  if (!row || String(row.kind || 'reservation') !== 'reservation' || departureCollected(id)) return 'closed';
  return stayStarted(id, now).started ? 'departure' : 'arrival';
}

function departureSalesOf(reservationId, now = new Date()) {
  return withRefundOwed(departureSection(saleDetailOf(reservationId, now)), reservationId);
}

// The departure SAS's section of what the stay already collected on its sold lines (rule 32).
function paidSalesOf(reservationId, now = new Date()) {
  const owed = extraSalesModel().openLoweredCents(Number(reservationId));
  const section = paidSection(saleDetailOf(reservationId, now)) || (owed > 0 ? { title: PAID_TITLE, lines: [], groups: [], totalCents: 0, dueCents: 0 } : null);
  return withRefundOwed(section, reservationId);
}

module.exports = {
  quote, sell, changeLine, removeLine, collectionOf, saleDetailOf, arrivalComplementDetailOf, departureSalesOf, paidSalesOf, parseRequests,
};
