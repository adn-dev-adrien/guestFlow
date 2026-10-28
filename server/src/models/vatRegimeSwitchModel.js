/**
 * Switching the VAT regime (specs/vat-optional-mode.md rules 14-19): the preview of a switch, the switch
 * itself, and the undo of an unused one. A switch is one transaction that inserts a period and moves
 * the reservations its scope names; the preview is that same transaction played inside a savepoint and
 * rolled back, so what the dialog announces is what the switch does.
 *
 * Every function takes the database. The leaf `vatRegimeModel` reads; this module writes, and so may
 * call the pricing engine (which reads `vatRegimeModel`).
 */

const vatRegimeModel = require('./vatRegimeModel');
const rules = require('../utils/vatRegime');
const { calculateReservationQuote } = require('../utils/pricing');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const { isTouristTaxFrozen } = require('../utils/touristTaxFreeze');
const { comptaCollected } = require('../utils/reservationSettlement');
const { todayIso } = require('../utils/localDate');

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const TAX_EPSILON = 0.004;

const tableExists = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const placeholders = (ids) => ids.map(() => '?').join(', ');

/** The reservations (stays and cancelled stays) a period would take, by rule 5's predicate. */
function reservationsTakenBy(db, candidate) {
  return db.prepare("SELECT * FROM reservations WHERE kind IN ('reservation', 'cancelled') ORDER BY id").all()
    .filter((row) => rules.appliesTo(candidate, { bookingDay: rules.bookingDayOf(row.createdAt), startDate: row.startDate }));
}

function changesRegimeOrRate(periods, row, candidate) {
  const current = periods.find((p) => p.id === row.vatPeriodId);
  return !current || current.regime !== candidate.regime || Number(current.rate) !== Number(candidate.rate);
}

function monthsOfPayments(db, ids) {
  if (!ids.length) return [];
  const dates = [];
  const rows = db.prepare(`SELECT depositPaid, depositPaidDate, balancePaid, balancePaidDate, complementPaid, complementPaidDate,
      endOfStayComplementPaid, endOfStayComplementPaidDate, midStaySettledNotes FROM reservations WHERE id IN (${placeholders(ids)})`).all(...ids);
  for (const r of rows) {
    if (r.depositPaid) dates.push(r.depositPaidDate);
    if (r.balancePaid) dates.push(r.balancePaidDate);
    if (r.complementPaid) dates.push(r.complementPaidDate);
    if (r.endOfStayComplementPaid) dates.push(r.endOfStayComplementPaidDate);
    try {
      (JSON.parse(r.midStaySettledNotes || '[]') || []).forEach((n) => dates.push(n && n.paidDate));
    } catch { /* an unreadable register has no dated note */ }
  }
  if (tableExists(db, 'reservation_installments')) {
    db.prepare(`SELECT paidDate FROM reservation_installments WHERE paid = 1 AND reservationId IN (${placeholders(ids)})`).all(...ids)
      .forEach((i) => dates.push(i.paidDate));
  }
  if (tableExists(db, 'reservation_refunds')) {
    db.prepare(`SELECT refundDate FROM reservation_refunds WHERE reservationId IN (${placeholders(ids)})`).all(...ids)
      .forEach((i) => dates.push(i.refundDate));
  }
  if (tableExists(db, 'cancellation_compensations')) {
    db.prepare(`SELECT receivedDate FROM cancellation_compensations WHERE reservationId IN (${placeholders(ids)}) AND status = 'received'`).all(...ids)
      .forEach((i) => dates.push(i.receivedDate));
  }
  return [...new Set(dates.filter(Boolean).map((d) => String(d).slice(0, 7)))].sort();
}

const quoteOf = (db, row) => {
  const quote = calculateReservationQuote(buildReservationEngineInput(db, row));
  return quote && !quote.error ? Number(quote.touristTaxTotal || 0) : null;
};

/**
 * Rule 17 — the exact effects of a switch, without making it. → { errors } or
 * { preview: { fingerprint, reassigned, collected, touristTaxChanged, touristTaxDelta, touristTaxKept,
 *   openLinks, exportMonths, devisDrafts, ids } }.
 */
function previewSwitch(db, input, { today = todayIso() } = {}) {
  const periods = vatRegimeModel.listPeriods(db);
  const { errors } = rules.validateSwitch(input, periods, { today });
  if (Object.keys(errors).length) return { errors };

  const candidate = rules.periodFromInput(input);
  const taken = reservationsTakenBy(db, candidate);
  const changed = taken.filter((row) => changesRegimeOrRate(periods, row, candidate));
  const stays = changed.filter((row) => row.kind === 'reservation');
  const movable = stays.filter((row) => !isTouristTaxFrozen(db, row));
  const frozen = stays.length - movable.length;

  const draftIds = db.prepare("SELECT id FROM reservations WHERE kind = 'devis' AND COALESCE(devisStatus, 'draft') != 'converted'").all().map((r) => r.id);
  const devisBefore = new Map(draftIds.map((id) => [id, vatRegimeModel.forRow(db, { id })]));
  const taxBefore = new Map(movable.map((row) => [row.id, quoteOf(db, row)]));

  let taxChanged = 0;
  let taxDelta = 0;
  let devisDrafts = 0;
  db.exec('SAVEPOINT vat_regime_preview');
  try {
    const periodId = Number(db.prepare(`INSERT INTO vat_periods (regime, rate, legalMention, basis, effectiveFrom)
      VALUES (@regime, @rate, @legalMention, @basis, @effectiveFrom)`).run(candidate).lastInsertRowid);
    if (changed.length) db.prepare(`UPDATE reservations SET vatPeriodId = ? WHERE id IN (${placeholders(changed.map((r) => r.id))})`).run(periodId, ...changed.map((r) => r.id));
    for (const row of movable) {
      const before = taxBefore.get(row.id);
      const after = quoteOf(db, db.prepare('SELECT * FROM reservations WHERE id = ?').get(row.id));
      if (before == null || after == null || Math.abs(after - before) <= TAX_EPSILON) continue;
      taxChanged += 1;
      taxDelta += after - before;
    }
    for (const id of draftIds) {
      const now = vatRegimeModel.forRow(db, { id });
      const was = devisBefore.get(id);
      if (now.regime !== was.regime || now.rate !== was.rate) devisDrafts += 1;
    }
  } finally {
    db.exec('ROLLBACK TO vat_regime_preview');
    db.exec('RELEASE vat_regime_preview');
  }

  const changedIds = changed.map((r) => r.id);
  let openLinks = 0;
  if (changedIds.length && tableExists(db, 'payment_links')) {
    openLinks = db.prepare(`SELECT COUNT(*) AS n FROM payment_links WHERE status = 'open' AND reservationId IN (${placeholders(changedIds)})`).get(...changedIds).n;
  }
  const latest = periods[periods.length - 1];
  return {
    preview: {
      fingerprint: rules.fingerprint({ input, reassignedIds: taken.map((r) => r.id), latestPeriodId: latest ? latest.id : 0 }),
      reassigned: changed.length,
      collected: changed.filter((row) => comptaCollected(row) > 0).length,
      touristTaxChanged: taxChanged,
      touristTaxDelta: round2(taxDelta),
      touristTaxKept: frozen,
      openLinks,
      exportMonths: monthsOfPayments(db, changedIds),
      devisDrafts,
      ids: taken.map((r) => r.id),
      changedIds,
    },
  };
}

/**
 * Rules 14-16, 19 — makes the switch. → { ok, period, reassigned } | { errors } | { stale: true }.
 * `userId` stamps the period; `fingerprint` is the preview's, refused when the set moved since.
 */
function applySwitch(db, input, { userId = null, fingerprint, acknowledged = false, today = todayIso() } = {}) {
  const checked = rules.validateSwitch(input, vatRegimeModel.listPeriods(db), { today });
  if (Object.keys(checked.errors).length) return { errors: checked.errors };
  if (input.basis === rules.BASES.ALL && acknowledged !== true) return { errors: { acknowledged: 'Confirmation requise' } };

  return db.transaction(() => {
    const { preview, errors } = previewSwitch(db, input, { today });
    if (errors) return { errors };
    if (!fingerprint || preview.fingerprint !== fingerprint) return { stale: true };

    const periods = vatRegimeModel.listPeriods(db);
    const candidate = rules.periodFromInput(input);
    const periodId = Number(db.prepare(`INSERT INTO vat_periods (regime, rate, legalMention, basis, effectiveFrom, createdBy)
      VALUES (@regime, @rate, @legalMention, @basis, @effectiveFrom, @createdBy)`).run({ ...candidate, createdBy: userId }).lastInsertRowid);
    const period = { id: periodId, ...candidate };

    const previous = new Map(preview.changedIds.length
      ? db.prepare(`SELECT id, vatPeriodId FROM reservations WHERE id IN (${placeholders(preview.changedIds)})`).all(...preview.changedIds)
        .map((r) => [r.id, periods.find((p) => p.id === r.vatPeriodId)])
      : []);
    const takenIds = preview.ids;
    if (takenIds.length) db.prepare(`UPDATE reservations SET vatPeriodId = ? WHERE id IN (${placeholders(takenIds)})`).run(periodId, ...takenIds);

    const dated = candidate.basis === rules.BASES.ALL ? today : candidate.effectiveFrom;
    const label = candidate.basis === rules.BASES.ALL ? 'correction' : 'changement';
    const insertHistory = db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)');
    for (const id of preview.changedIds) {
      insertHistory.run(id, 'update', JSON.stringify([{
        field: 'vatRegime',
        label: 'Régime de TVA',
        fromText: rules.regimeLabel(previous.get(id) || period),
        toText: `${rules.regimeLabel(period)} (${label} du ${rules.frDate(dated)})`,
      }]));
    }

    if (preview.changedIds.length && tableExists(db, 'reservation_refund_lines')) {
      db.prepare(`UPDATE reservation_refund_lines SET vatRate = ? WHERE bucket != 'touristTax'
        AND refundId IN (SELECT id FROM reservation_refunds WHERE reservationId IN (${placeholders(preview.changedIds)}))`)
        .run(candidate.rate, ...preview.changedIds);
    }
    vatRegimeModel.syncMirror(db);
    return { ok: true, period: { ...period }, reassigned: preview.reassigned };
  })();
}

const userName = (row) => `${row.firstName || ''} ${row.lastName || ''}`.trim() || row.email || '';

/** The settings card's state (§4.3): the period in force, the history newest first, the mentions. */
function readState(db, { accountingExportActive = false, today = todayIso() } = {}) {
  const periods = vatRegimeModel.listPeriods(db);
  const counts = new Map(db.prepare("SELECT vatPeriodId, COUNT(*) AS n FROM reservations WHERE kind IN ('reservation', 'cancelled') GROUP BY vatPeriodId").all()
    .map((r) => [r.vatPeriodId, r.n]));
  const authors = new Map(db.prepare('SELECT id, firstName, lastName, email FROM users').all().map((u) => [u.id, userName(u)]));
  const latest = periods[periods.length - 1];
  const view = (p) => ({
    id: p.id,
    regime: p.regime,
    rate: Number(p.rate),
    legalMention: p.legalMention,
    legalMentionText: rules.mentionText(p.legalMention, 'fr'),
    basis: p.basis,
    effectiveFrom: p.effectiveFrom,
    createdAt: p.createdAt,
    createdByName: authors.get(p.createdBy) || '',
    reservations: counts.get(p.id) || 0,
    deletable: Boolean(latest) && p.id === latest.id && p.id !== periods[0].id && !(counts.get(p.id) || 0),
    scheduled: Boolean(p.effectiveFrom) && p.effectiveFrom > today,
    correction: p.basis === rules.BASES.ALL && p.note !== 'initial',
    label: rules.periodLabel(p),
  });
  const current = vatRegimeModel.inForce(db);
  return {
    inForce: current ? view(current) : null,
    periods: periods.map(view).reverse(),
    mentions: Object.keys(rules.MENTIONS).map((key) => ({ key, label: rules.MENTIONS[key].fr })),
    accountingExportActive: Boolean(accountingExportActive),
  };
}

/** Rule 18 — the latest period, when nothing was sold under it. → { ok } or { error }. */
function deletePeriod(db, id) {
  const periods = vatRegimeModel.listPeriods(db);
  const target = periods.find((p) => p.id === Number(id));
  if (!target) return { error: 'not_found' };
  if (target.id === periods[0].id) return { error: 'initial_period' };
  if (target.id !== periods[periods.length - 1].id) return { error: 'not_latest' };
  const used = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE vatPeriodId = ? AND kind IN ('reservation', 'cancelled')").get(target.id).n;
  if (used) return { error: 'period_in_use' };
  db.transaction(() => {
    const previous = periods[periods.length - 2];
    db.prepare("UPDATE reservations SET vatPeriodId = ? WHERE vatPeriodId = ? AND kind = 'devis'").run(previous.id, target.id);
    db.prepare('DELETE FROM vat_periods WHERE id = ?').run(target.id);
    vatRegimeModel.syncMirror(db);
  })();
  return { ok: true };
}

module.exports = { previewSwitch, applySwitch, readState, deletePeriod };
