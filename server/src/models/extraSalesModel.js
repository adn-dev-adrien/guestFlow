/**
 * Extra sales model — the database side of `utils/extraSale.js` (specs/pricing-components.md §3 rules 18, 27, 37, 39, 46).
 *
 * It reads and writes the sale columns of the three line tables (`source`, `soldAt`, `collectAt`, `collectAtDefault`, `discountCents`)
 * and the stay's extras baseline; it prices nothing and decides no refusal other than the ones about a stored line.
 *
 *   lineIds(reservationId)                       the Set of `<kind>:<lineId>` the stay holds
 *   stampNewLines(reservationId, before, sale)   writes source / moment / date on the lines that were not in `before` → [{ label }]
 *   findLine(reservationId, ref)                 `ref` = `option:<lineId>` | `resource:<lineId>` | `custom:<lineId>` → the stored line or null
 *   momentRefusal(reservationId, line, to, moments) / moveLine(reservationId, line, to)    rule 37: the 409 or null / the move, journaled by the caller
 *   lowerLine(reservationId, line, { discount, offered })  → { body, text, discountCents } | { error }   rule 39 / 14: the PUT body that offers it or carries the discount
 *   storeDiscount(line, cents)                   the line's own discount, stored once the save went through
 *   withoutLine(body, line)                      the fiche's PUT body without that one line (rule 25: an unpaid line removed)
 *   stampCustomQuantities(reservationId, added, requests)  the count a sold custom line carries (« Taie d'oreiller ×2 »)
 *   stampIntakeLines(reservationId, platform, soldAt)  the lines a platform intake wrote and left without a moment: `platform` or `arrival` (rule 17)
 *   stampSasLines(reservationId, soldAt, { reopened })  the lines an arrival SAS wrote carry source `sas` and the arrival moment (rule 18); a reopened run flags the lines it appended
 *   openLoweredCents(reservationId)              the open `lineLowered` obligations, in cents
 *   vatClassOf(line, kind)                       the VAT class of a priced line: the article's own, else its family's
 */
const { toCents, roundMoney } = require('../utils/pricing/money');
const { extraLineKey } = require('../utils/pricing/storedLines');
const { keyLines } = require('../utils/pricing/lineKeys');
const { VAT_CLASSES } = require('../utils/pricing/vat/settingsSchema');

const database = () => require('../database');

const KINDS = {
  option: { table: 'reservation_options', label: 'SELECT ro.*, o.title AS label FROM reservation_options ro JOIN options o ON o.id = ro.optionId WHERE ro.reservationId = ? AND ro.lineId = ?' },
  resource: { table: 'reservation_resources', label: 'SELECT rr.*, r.name AS label FROM reservation_resources rr JOIN resources r ON r.id = rr.resourceId WHERE rr.reservationId = ? AND rr.lineId = ?' },
  custom: { table: 'reservation_custom_options', label: 'SELECT rco.*, rco.description AS label FROM reservation_custom_options rco WHERE rco.reservationId = ? AND rco.lineId = ?' },
};

const MOMENT_TEXT = Object.freeze({ plan: 'à l’acompte et au solde', platform: 'dans le prix plateforme', arrival: 'à payer à l’arrivée', departure: 'à payer au départ' });

function lineIds(reservationId) {
  const db = database();
  const ids = new Set();
  for (const [kind, { table }] of Object.entries(KINDS)) {
    for (const row of db.prepare(`SELECT lineId FROM ${table} WHERE reservationId = ?`).all(Number(reservationId))) ids.add(`${kind}:${row.lineId}`);
  }
  return ids;
}

function stampNewLines(reservationId, before, { source, collectAt, soldAt }) {
  const db = database();
  const added = [];
  for (const [kind, { table, label }] of Object.entries(KINDS)) {
    for (const row of db.prepare(`SELECT lineId FROM ${table} WHERE reservationId = ?`).all(Number(reservationId))) {
      if (before.has(`${kind}:${row.lineId}`)) continue;
      db.prepare(`UPDATE ${table} SET source = ?, collectAt = ?, collectAtDefault = ?, soldAt = ? WHERE lineId = ?`).run(source, collectAt, collectAt, soldAt, row.lineId);
      const named = db.prepare(label).get(Number(reservationId), row.lineId);
      added.push({ kind, lineId: row.lineId, label: named ? String(named.label) : '' });
    }
  }
  return added;
}

// Rule 18 — what the arrival SAS sold is a sale of source `sas`, collected at arrival. A re-run changes the SAS's own lines in place and appends the new ones
// (rule 14, reopen-completed-sas rule 4): on a reopened SAS the lines not yet stamped are the ones this run appended, they carry `addedOnReopen` and their
// labels come back for the journal.
function stampSasLines(reservationId, soldAt, { reopened = false } = {}) {
  const db = database();
  const appended = [];
  for (const [table, label] of [['reservation_options', '(SELECT title FROM options WHERE id = t.optionId)'], ['reservation_custom_options', 't.description']]) {
    if (reopened) {
      for (const row of db.prepare(`SELECT t.rowid AS rid, ${label} AS label FROM ${table} t WHERE t.reservationId = ? AND COALESCE(t.sasArrivalOrigin, 0) = 1 AND t.soldAt IS NULL`).all(Number(reservationId))) {
        db.prepare(`UPDATE ${table} SET addedOnReopen = 1 WHERE rowid = ?`).run(row.rid);
        appended.push(String(row.label || 'Prestation'));
      }
    }
    db.prepare(`UPDATE ${table} SET source = 'sas', collectAt = COALESCE(collectAt, 'arrival'), collectAtDefault = COALESCE(collectAtDefault, 'arrival'),
      soldAt = COALESCE(soldAt, ?) WHERE reservationId = ? AND COALESCE(sasArrivalOrigin, 0) = 1`).run(soldAt, Number(reservationId));
  }
  return appended;
}

// Rule 17 — what a platform intake wrote and left without a moment is declared now: inside the platform price (`platform`) or collected on
// arrival (`arrival`), from the routing flag the intake set. A sale made later is never a platform line (its moment is the clock's).
function stampIntakeLines(reservationId, platform, soldAt) {
  const { saleChannel } = require('../utils/saleChannel');
  if (!saleChannel(platform).platformSale) return;
  const db = database();
  for (const table of ['reservation_options', 'reservation_custom_options', 'reservation_resources']) {
    db.prepare(`UPDATE ${table} SET source = 'intake', collectAt = CASE WHEN inComplement = 1 THEN 'arrival' ELSE 'platform' END,
      collectAtDefault = CASE WHEN inComplement = 1 THEN 'arrival' ELSE 'platform' END, soldAt = COALESCE(soldAt, ?)
      WHERE reservationId = ? AND collectAt IS NULL`).run(soldAt, Number(reservationId));
  }
}

// Rule 85: the key the engine gives a stored line — the legacy key for an article's first line, its `lineRef` for a later sale.
function storedLineKey(db, table, reservationId, lineId) {
  const field = table === 'reservation_options' ? 'optionId' : 'resourceId';
  const rows = db.prepare(`SELECT lineId, ${field} FROM ${table} WHERE reservationId = ?`).all(reservationId);
  const entry = keyLines(table, rows).find((e) => Number(e.row.lineId) === lineId);
  return entry ? entry.key : null;
}

function findLine(reservationId, ref) {
  const match = /^(option|resource|custom):([1-9]\d*)$/.exec(String(ref));
  if (!match) return null;
  const db = database();
  const row = db.prepare(KINDS[match[1]].label).get(Number(reservationId), Number(match[2]));
  if (!row) return null;
  const { create } = require('./ports/stayRepository');
  const key = match[1] === 'custom' ? extraLineKey({ isCustom: true, description: row.description }) : storedLineKey(db, KINDS[match[1]].table, Number(reservationId), Number(match[2]));
  const fact = create(db).lineFacts(reservationId)[key] || {};
  return {
    kind: match[1], table: KINDS[match[1]].table, lineId: Number(match[2]), key, label: String(row.label || 'Prestation'), row,
    totalCents: toCents(match[1] === 'custom' ? row.amount : row.totalPrice), offered: Number(row.offered || 0) === 1,
    settledCents: Number(fact.settledCents || 0), collectAt: row.collectAt || null, collectAtDefault: row.collectAtDefault || null,
  };
}

function momentRefusal(reservationId, line, to, moments) {
  if (!moments.includes(to)) return { status: 400, body: { error: 'Moment inconnu.', code: 'INVALID_MOMENT' } };
  if (line.settledCents > 0) return { status: 409, body: { error: 'Ligne déjà payée : son moment est figé.', code: 'LINE_PAID' } };
  const stay = database().prepare('SELECT complementPaid, complementPaidCash, endOfStayComplementPaid, endOfStayComplementPaidCash FROM reservations WHERE id = ?').get(Number(reservationId));
  if (!stay) return { status: 404, body: { error: 'Réservation introuvable', code: 'RESERVATION_NOT_FOUND' } };
  const arrivalCollected = Number(stay.complementPaid || 0) === 1 || Number(stay.complementPaidCash || 0) === 1;
  const departureCollected = Number(stay.endOfStayComplementPaid || 0) === 1 || Number(stay.endOfStayComplementPaidCash || 0) === 1;
  const unavailable = (to === 'platform' || to === 'plan')
    || (to === 'arrival' && arrivalCollected)
    || (to === 'departure' && departureCollected);
  if (unavailable && to !== line.collectAt) return { status: 409, body: { error: 'Ce moment n’est plus possible pour ce séjour.', code: 'MOMENT_NOT_AVAILABLE' } };
  return null;
}

// The arrival baseline (`{ lineKey → TTC }`) says which part of a line was sold at arrival: what exceeds it is paid at departure (rule 20).
function moveLine(reservationId, line, to) {
  if ((line.collectAt || null) === to) return null;
  const db = database();
  const reservations = require('./reservationsModel');
  // Stored, or laid now from the lines as they stand (a stay not started yet has none).
  const baseline = JSON.parse(reservations.peekArrivalExtrasBaseline(Number(reservationId)) || '{}');
  const total = line.totalCents / 100;
  if (to === 'departure') baseline[line.key] = Math.max(0, roundMoney((baseline[line.key] || 0) - total));
  else if (to === 'arrival') baseline[line.key] = roundMoney((baseline[line.key] || 0) + total);
  db.prepare("UPDATE reservations SET arrivalExtrasBaseline = ?, updatedAt = datetime('now') WHERE id = ?").run(JSON.stringify(baseline), Number(reservationId));
  const was = line.collectAt || 'arrival';
  // A line moved to the arrival is routed into the arrival complement, as a new line of a stay not started is (rule 19): the moment the line
  // says and the bucket that collects it are one (rule 31). A line sent to the departure keeps its routing: the baseline carves it out.
  if (to === 'arrival') db.prepare(`UPDATE ${line.table} SET collectAt = ?, inComplement = 1 WHERE lineId = ?`).run(to, line.lineId);
  else db.prepare(`UPDATE ${line.table} SET collectAt = ? WHERE lineId = ?`).run(to, line.lineId);
  const origin = (moment) => (moment === (line.collectAtDefault || was) ? 'horloge' : 'opérateur');
  return {
    fromLabel: `${MOMENT_TEXT[was]} (${origin(was)})`,
    toLabel: `${MOMENT_TEXT[to]} (${to === line.collectAtDefault ? 'horloge' : 'opérateur'})`,
  };
}

function lowerLine(reservationId, line, wants) {
  const db = database();
  const { storedBody } = require('../utils/midStayOrderCommit');
  const body = storedBody(reservationId);
  if (!body) return { error: { status: 404, body: { error: 'Réservation introuvable', code: 'RESERVATION_NOT_FOUND' } } };
  let text = '';
  let discountCents = null;
  if (wants.discount !== undefined) {
    const { percent, amount } = wants.discount || {};
    const gross = line.totalCents;
    const wanted = amount != null ? toCents(amount) : Math.round((gross * Math.max(0, Math.min(100, Number(percent) || 0))) / 100);
    if (!(wanted >= 0)) return { error: { status: 400, body: { error: 'Remise invalide.', code: 'INVALID_DISCOUNT' } } };
    const cents = Math.min(wanted, gross);
    body.lineDiscounts = { [line.key]: cents };
    discountCents = cents;
    text = cents ? `remise de ${(cents / 100).toFixed(2).replace('.', ',')} €` : 'remise retirée';
  }
  if (wants.offered !== undefined) {
    const offered = Boolean(wants.offered);
    // Rule 85: « offert » is the line's own — an article sold twice offers the one line the operator named.
    if (line.kind === 'option') {
      body.options = body.options.map((o) => (Number(o.lineId) === line.lineId ? { ...o, offered } : o));
      const named = new Set(body.options.map((o) => Number(o.optionId)));
      body.offeredOptionIds = [...new Set([
        ...(body.offeredOptionIds || []).map(Number).filter((id) => !named.has(id)),
        ...body.options.filter((o) => o.offered).map((o) => Number(o.optionId)),
      ])];
    } else if (line.kind === 'resource') {
      body.resources = body.resources.map((r) => (Number(r.lineId) === line.lineId ? { ...r, offered } : r));
    } else {
      body.customOptions = body.customOptions.map((c) => (Number(c.customOptionId) === Number(line.row.id) ? { ...c, offered } : c));
    }
    text = `${text ? `${text}, ` : ''}${offered ? 'offerte' : 'refacturée'}`;
  }
  return { body, text, paidLine: line.settledCents > 0, discountCents };
}

// The fiche's body without the one line the operator removes: an article sold twice loses the line named, never the other (rule 85).
function withoutLine(body, line) {
  if (line.kind === 'option') {
    const options = body.options.filter((o) => Number(o.lineId) !== line.lineId);
    const named = new Set(options.map((o) => Number(o.optionId)));
    return { ...body, options, offeredOptionIds: (body.offeredOptionIds || []).map(Number).filter((id) => named.has(id)) };
  }
  if (line.kind === 'resource') return { ...body, resources: body.resources.filter((r) => Number(r.lineId) !== line.lineId) };
  return { ...body, customOptions: body.customOptions.filter((c) => Number(c.customOptionId) !== Number(line.row.id)) };
}

// A custom line sold with a count keeps it (the fiche's body carries no count for a custom line). `added` is in the order the sale wrote the lines.
function stampCustomQuantities(reservationId, added, requests) {
  const customs = added.filter((line) => line.kind === 'custom');
  const db = database();
  if (!db.prepare('PRAGMA table_info(reservation_custom_options)').all().some((c) => c.name === 'quantity')) return;
  customs.forEach((line, index) => {
    const request = requests[index];
    if (request && request.quantity > 1) db.prepare('UPDATE reservation_custom_options SET quantity = ? WHERE reservationId = ? AND lineId = ?').run(request.quantity, Number(reservationId), line.lineId);
  });
}

// Once the save went through, the line keeps its own discount as a stored fact (rule 39).
function storeDiscount(line, cents) {
  if (cents == null) return;
  database().prepare(`UPDATE ${line.table} SET discountCents = ? WHERE lineId = ?`).run(cents, line.lineId);
}

// What the stay owes back for lowered lines, still open (the sale service compares it before and after a confirmed lowering).
function openLoweredCents(reservationId) {
  return Number(database().prepare("SELECT COALESCE(SUM(amountCents), 0) AS cents FROM refund_obligations WHERE reservationId = ? AND origin = 'lineLowered' AND status = 'open'")
    .get(Number(reservationId)).cents);
}

function vatClassOf(line, kind) {
  const db = database();
  const own = kind === 'option' && line.optionId != null
    ? db.prepare('SELECT vatClass FROM options WHERE id = ?').get(Number(line.optionId))
    : kind === 'resource' && line.resourceId != null ? db.prepare('SELECT vatClass FROM resources WHERE id = ?').get(Number(line.resourceId)) : null;
  if (own && VAT_CLASSES.includes(own.vatClass)) return own.vatClass;
  return kind === 'resource' ? 'resources' : 'options';
}

module.exports = {
  lineIds, stampNewLines, stampSasLines, stampIntakeLines, findLine, momentRefusal, moveLine, lowerLine, storeDiscount, openLoweredCents, vatClassOf,
  withoutLine, stampCustomQuantities,
};
