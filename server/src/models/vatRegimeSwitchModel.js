/**
 * Switching the VAT regime (specs/vat-optional-mode.md rules 14-19, 24-28): the preview of a switch, the
 * switch itself, and the undo of an unused or not-yet-started one. A switch is one transaction that
 * inserts a period, moves the reservations its scope names, and re-saves the stays whose proportional
 * tourist tax the regime moves, through the fiche's own save path; the preview is that same work played
 * inside a savepoint and rolled back, so what the dialog announces is what the switch does.
 *
 * Every function takes the database. The leaf `vatRegimeModel` reads; this module writes, and so may
 * call the pricing engine and the fiche's save.
 */

const vatRegimeModel = require('./vatRegimeModel');
const rules = require('../utils/vatRegime');
const { isTouristTaxFrozen } = require('../utils/touristTaxFreeze');
const { comptaCollected } = require('../utils/reservationSettlement');
const { todayIso, localIsoDate } = require('../utils/localDate');

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

/**
 * Rule 17 — the months of the books a switch rewrites: those where an affected reservation has a booked
 * encaissement, under the journal's own predicates (paid, not in cash, a real amount; a refund that is not
 * internal; a compensation received). The accounting plugin may be off, so this is the core's reading of
 * the same facts, not a diff of the plugin's entries.
 */
function monthsOfPayments(db, ids) {
  if (!ids.length) return [];
  const dates = [];
  const rows = db.prepare(`SELECT depositPaid, depositPaidDate, depositAmount, COALESCE(depositPaidCash, 0) AS depositCash,
      balancePaid, balancePaidDate, balanceAmount, COALESCE(balancePaidCash, 0) AS balanceCash,
      complementPaid, complementPaidDate, complementAmount, COALESCE(complementPaidCash, 0) AS complementCash,
      endOfStayComplementPaid, endOfStayComplementPaidDate, endOfStayComplementAmount, COALESCE(endOfStayComplementPaidCash, 0) AS endOfStayCash,
      midStaySettledNotes FROM reservations WHERE id IN (${placeholders(ids)})`).all(...ids);
  const booked = (paid, date, amount, cash) => { if (paid && !cash && Number(amount) > 0) dates.push(date); };
  for (const r of rows) {
    booked(r.depositPaid, r.depositPaidDate, r.depositAmount, r.depositCash);
    booked(r.balancePaid, r.balancePaidDate, r.balanceAmount, r.balanceCash);
    booked(r.complementPaid, r.complementPaidDate, r.complementAmount, r.complementCash);
    booked(r.endOfStayComplementPaid, r.endOfStayComplementPaidDate, r.endOfStayComplementAmount, r.endOfStayCash);
    try {
      (JSON.parse(r.midStaySettledNotes || '[]') || []).forEach((n) => { if (n && !Number(n.paidCash)) dates.push(n.paidDate); });
    } catch { /* an unreadable register has no dated note */ }
  }
  if (tableExists(db, 'reservation_installments')) {
    db.prepare(`SELECT paidDate FROM reservation_installments WHERE paid = 1 AND amountCents > 0 AND reservationId IN (${placeholders(ids)})`).all(...ids)
      .forEach((i) => dates.push(i.paidDate));
  }
  if (tableExists(db, 'reservation_refunds')) {
    db.prepare(`SELECT refundDate FROM reservation_refunds WHERE totalTtc > 0 AND COALESCE(method, '') != 'internal' AND reservationId IN (${placeholders(ids)})`).all(...ids)
      .forEach((i) => dates.push(i.refundDate));
  }
  if (tableExists(db, 'cancellation_compensations')) {
    db.prepare(`SELECT receivedDate FROM cancellation_compensations WHERE receivedAmount > 0 AND reservationId IN (${placeholders(ids)}) AND status = 'received'`).all(...ids)
      .forEach((i) => dates.push(i.receivedDate));
  }
  return [...new Set(dates.filter(Boolean).map((d) => String(d).slice(0, 7)))].sort();
}

const proportionalTax = (db, row) => {
  const property = db.prepare('SELECT touristTaxMode FROM properties WHERE id = ?').get(row.propertyId);
  return Boolean(property) && String(property.touristTaxMode || '').startsWith('percentage');
};

/** The stays a regime can re-price: a proportional tourist tax that no payment or declaration froze. */
function repriceable(db, rows) {
  return rows.filter((row) => row.kind === 'reservation' && !isTouristTaxFrozen(db, row) && proportionalTax(db, row));
}

/**
 * Rule 27 — one stay re-saved through the fiche's own save path (it keeps the freeze, the locked prices
 * and the schedule, and writes the stay's history). `dryRun` answers what the save would store, writing
 * nothing. → { status, row } ; a refused save leaves the stay as it was.
 */
function resaveStay(db, id, { dryRun = false } = {}) {
  const controller = require('../controllers/reservationsController');
  const { toUpdateBody } = require('../utils/reservationUpdateBody');
  const current = require('./reservationsModel').getByIdWithDetails(Number(id));
  if (!current || current.kind !== 'reservation') return { status: 404 };
  const autoEnabled = new Set(db.prepare('SELECT id FROM options WHERE COALESCE(autoEnabled, 0) = 1').all().map((o) => o.id));
  const result = controller.performUpdate(Number(id), toUpdateBody(current, autoEnabled), { unlockPast: true, dryRun });
  return { status: result.status, row: result.row || db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id)) };
}

/**
 * Rule 27 — re-saves a stay only when the save changes nothing but what the regime moves: the price paid
 * must hold (« Prix inchangés »). A stay whose save would also move its price (priced under an earlier
 * rule) keeps its stored figures and is reported. → true when the stay was re-saved (or only previewed).
 */
function resaveKeepingPrice(db, row, { dryRun = false } = {}) {
  const probe = resaveStay(db, row.id, { dryRun: true });
  if (probe.status !== 200 || Math.abs(Number(probe.row.finalPrice || 0) - Number(row.finalPrice || 0)) > TAX_EPSILON) return { ok: false };
  return dryRun ? { ok: true, row: probe.row } : { ok: resaveStay(db, row.id).status === 200 };
}

/** Rule 27, also for the retroactive rate edit (rule 9): re-saves the re-priceable stays of a period. */
function repriceStaysOfPeriod(db, periodId) {
  const rows = db.prepare("SELECT * FROM reservations WHERE kind = 'reservation' AND vatPeriodId = ?").all(Number(periodId));
  return repriceable(db, rows).filter((row) => !resaveKeepingPrice(db, row).ok).map((row) => row.id);
}

function openLinksOf(db, ids) {
  if (!ids.length || !tableExists(db, 'payment_links')) return 0;
  return db.prepare(`SELECT COUNT(*) AS n FROM payment_links WHERE status = 'open' AND reservationId IN (${placeholders(ids)})`).get(...ids).n;
}

/**
 * Rule 17 — the exact effects of a switch, without making it. → { errors } or { preview: { fingerprint,
 * reassigned, collected, touristTaxChanged, touristTaxDelta, touristTaxKept, openLinks, linksReplaced,
 * exportMonths, devisDrafts, needsAcknowledgement, notRepriced, fromRegime, ids, changedIds } }.
 */
function previewSwitch(db, input, { today = todayIso() } = {}) {
  const periods = vatRegimeModel.listPeriods(db);
  const { errors } = rules.validateSwitch(input, periods, { today });
  if (Object.keys(errors).length) return { errors };

  const candidate = rules.periodFromInput(input);
  const taken = reservationsTakenBy(db, candidate);
  const changed = taken.filter((row) => changesRegimeOrRate(periods, row, candidate));
  const stays = changed.filter((row) => row.kind === 'reservation');
  const movable = repriceable(db, changed);
  const frozen = stays.filter((row) => isTouristTaxFrozen(db, row)).length;

  const draftIds = db.prepare("SELECT id FROM reservations WHERE kind = 'devis' AND COALESCE(devisStatus, 'draft') != 'converted'").all().map((r) => r.id);
  const devisBefore = new Map(draftIds.map((id) => [id, vatRegimeModel.forRow(db, { id })]));
  const taxBefore = new Map(movable.map((row) => [row.id, Number(row.touristTaxTotal || 0)]));

  let taxDelta = 0;
  let devisDrafts = 0;
  const taxChangedIds = [];
  let notRepriced = 0;
  db.exec('SAVEPOINT vat_regime_preview');
  try {
    const periodId = Number(db.prepare(`INSERT INTO vat_periods (regime, rate, legalMention, basis, effectiveFrom)
      VALUES (@regime, @rate, @legalMention, @basis, @effectiveFrom)`).run(candidate).lastInsertRowid);
    if (changed.length) db.prepare(`UPDATE reservations SET vatPeriodId = ? WHERE id IN (${placeholders(changed.map((r) => r.id))})`).run(periodId, ...changed.map((r) => r.id));
    for (const row of movable) {
      const saved = resaveKeepingPrice(db, row, { dryRun: true });
      if (!saved.ok) { notRepriced += 1; continue; }
      const delta = Number(saved.row.touristTaxTotal || 0) - taxBefore.get(row.id);
      if (Math.abs(delta) <= TAX_EPSILON) continue;
      taxChangedIds.push(row.id);
      taxDelta += delta;
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
  const collected = changed.filter((row) => comptaCollected(row) > 0).length;
  const exportMonths = monthsOfPayments(db, changedIds);
  const replaced = openLinksOf(db, taxChangedIds);
  const latest = periods[periods.length - 1];
  return {
    preview: {
      fingerprint: rules.fingerprint({
        input, reassignedIds: taken.map((r) => r.id), periods, settingsRate: vatRegimeModel.mirrorRate(db),
      }),
      reassigned: changed.length,
      collected,
      touristTaxChanged: taxChangedIds.length,
      touristTaxDelta: round2(taxDelta),
      touristTaxKept: frozen,
      openLinks: openLinksOf(db, changedIds) - replaced,
      linksReplaced: replaced,
      exportMonths,
      devisDrafts,
      notRepriced,
      needsAcknowledgement: candidate.basis === rules.BASES.ALL || collected > 0 || exportMonths.length > 0,
      fromRegime: latest ? latest.regime : null,
      ids: taken.map((r) => r.id),
      changedIds,
    },
  };
}

/**
 * Rules 14-16, 19, 24, 26, 27 — makes the switch. → { ok, period, reassigned, notRepriced } | { errors } |
 * { stale: true }. `userId` stamps the period; `fingerprint` is the preview's, refused when the set or the
 * rates moved since; `acknowledged` is what rule 24 asks before books or collected money are rewritten.
 */
function applySwitch(db, input, { userId = null, fingerprint, acknowledged = false, today = todayIso() } = {}) {
  const checked = rules.validateSwitch(input, vatRegimeModel.listPeriods(db), { today });
  if (Object.keys(checked.errors).length) return { errors: checked.errors };

  return db.transaction(() => {
    const { preview, errors } = previewSwitch(db, input, { today });
    if (errors) return { errors };
    if (!fingerprint || preview.fingerprint !== fingerprint) return { stale: true };
    if (preview.needsAcknowledgement && acknowledged !== true) return { errors: { acknowledged: 'Confirmation requise' } };

    const periods = vatRegimeModel.listPeriods(db);
    const candidate = rules.periodFromInput(input);
    const previousOf = new Map(db.prepare("SELECT id, vatPeriodId FROM reservations WHERE kind IN ('reservation', 'cancelled')").all()
      .filter((r) => preview.ids.includes(r.id)).map((r) => [r.id, r.vatPeriodId]));
    const periodId = Number(db.prepare(`INSERT INTO vat_periods (regime, rate, legalMention, basis, effectiveFrom, createdBy, movedFrom)
      VALUES (@regime, @rate, @legalMention, @basis, @effectiveFrom, @createdBy, @movedFrom)`)
      .run({ ...candidate, createdBy: userId, movedFrom: JSON.stringify(Object.fromEntries(previousOf)) }).lastInsertRowid);
    const period = { id: periodId, ...candidate };

    if (preview.ids.length) db.prepare(`UPDATE reservations SET vatPeriodId = ? WHERE id IN (${placeholders(preview.ids)})`).run(periodId, ...preview.ids);

    const dated = candidate.basis === rules.BASES.ALL ? today : candidate.effectiveFrom;
    const label = candidate.basis === rules.BASES.ALL ? 'correction' : 'changement';
    const insertHistory = db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)');
    for (const id of preview.changedIds) {
      const before = periods.find((p) => p.id === previousOf.get(id));
      insertHistory.run(id, 'update', JSON.stringify([{
        field: 'vatRegime',
        label: 'Régime de TVA',
        fromText: rules.regimeLabel(before || period),
        toText: `${rules.regimeLabel(period)} (${label} du ${rules.frDate(dated)})`,
      }]));
    }

    if (preview.changedIds.length && tableExists(db, 'reservation_refund_lines')) {
      db.prepare(`UPDATE reservation_refund_lines SET vatRate = ? WHERE bucket != 'touristTax'
        AND refundId IN (SELECT id FROM reservation_refunds WHERE reservationId IN (${placeholders(preview.changedIds)}))`)
        .run(candidate.rate, ...preview.changedIds);
    }
    const moved = db.prepare(`SELECT * FROM reservations WHERE id IN (${placeholders(preview.changedIds.length ? preview.changedIds : [0])})`).all(...(preview.changedIds.length ? preview.changedIds : [0]));
    const notRepriced = repriceable(db, moved).filter((row) => !resaveKeepingPrice(db, row).ok).map((row) => row.id);
    vatRegimeModel.syncMirror(db);
    return { ok: true, period: { ...period }, reassigned: preview.reassigned, notRepriced };
  })();
}

const userName = (row) => `${row.firstName || ''} ${row.lastName || ''}`.trim() || 'Un administrateur';

/** A period that has not started: nothing sold after it, and its date is still ahead (rule 26). */
const hasNotStarted = (period, today) => Boolean(period.effectiveFrom) && period.effectiveFrom > today;

/** The settings card's state (§4.3): the period in force, the history newest first, the mentions. */
function readState(db, { accountingExportActive = false, today = todayIso() } = {}) {
  const periods = vatRegimeModel.listPeriods(db);
  const counts = new Map(db.prepare("SELECT vatPeriodId, COUNT(*) AS n FROM reservations WHERE kind IN ('reservation', 'cancelled') GROUP BY vatPeriodId").all()
    .map((r) => [r.vatPeriodId, r.n]));
  const authors = new Map(db.prepare('SELECT id, firstName, lastName FROM users').all().map((u) => [u.id, userName(u)]));
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
    createdAtDay: rules.bookingDayOf(p.createdAt),
    createdByName: p.createdBy ? (authors.get(p.createdBy) || 'Un administrateur') : '',
    reservations: counts.get(p.id) || 0,
    deletable: Boolean(latest) && p.id === latest.id && p.id !== periods[0].id && (!(counts.get(p.id) || 0) || hasNotStarted(p, today)),
    scheduled: hasNotStarted(p, today),
    correction: p.basis === rules.BASES.ALL && p.note !== 'initial',
    initial: p.id === periods[0].id,
    label: rules.periodLabel(p),
  });
  const current = vatRegimeModel.inForce(db);
  return {
    inForce: current ? view(current) : null,
    latest: latest ? view(latest) : null,
    periods: periods.map(view).reverse(),
    mentions: Object.keys(rules.MENTIONS).map((key) => ({ key, label: rules.MENTIONS[key].fr, short: rules.MENTIONS[key].short })),
    accountingExportActive: Boolean(accountingExportActive),
  };
}

/**
 * Rules 18 and 26 — the latest period, when nothing was sold under it or it has not started: the
 * reservations it took go back to the period each had before (re-priced like the switch did), the ones
 * born since by the trigger fall to the period the others now give them. → { ok } or { error }.
 */
function deletePeriod(db, id, { today = todayIso() } = {}) {
  const periods = vatRegimeModel.listPeriods(db);
  const target = periods.find((p) => p.id === Number(id));
  if (!target) return { error: 'not_found' };
  if (target.id === periods[0].id) return { error: 'initial_period' };
  if (target.id !== periods[periods.length - 1].id) return { error: 'not_latest' };
  const used = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE vatPeriodId = ? AND kind IN ('reservation', 'cancelled')").get(target.id).n;
  if (used && !hasNotStarted(target, today)) return { error: 'period_in_use' };
  const stored = db.prepare('SELECT movedFrom FROM vat_periods WHERE id = ?').get(target.id);
  let movedFrom = {};
  try { movedFrom = JSON.parse((stored && stored.movedFrom) || '{}') || {}; } catch { movedFrom = {}; }
  const remaining = periods.filter((p) => p.id !== target.id);

  db.transaction(() => {
    const rows = db.prepare("SELECT * FROM reservations WHERE vatPeriodId = ? AND kind IN ('reservation', 'cancelled')").all(target.id);
    const put = db.prepare('UPDATE reservations SET vatPeriodId = ? WHERE id = ?');
    const insertHistory = db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)');
    const restored = [];
    for (const row of rows) {
      const before = movedFrom[row.id] != null && remaining.some((p) => p.id === Number(movedFrom[row.id]))
        ? remaining.find((p) => p.id === Number(movedFrom[row.id]))
        : rules.pickPeriod(remaining, { bookingDay: rules.bookingDayOf(row.createdAt), startDate: row.startDate });
      put.run(before.id, row.id);
      if (before.regime !== target.regime || Number(before.rate) !== Number(target.rate)) {
        restored.push({ row, before });
        insertHistory.run(row.id, 'update', JSON.stringify([{
          field: 'vatRegime',
          label: 'Régime de TVA',
          fromText: rules.regimeLabel(target),
          toText: `${rules.regimeLabel(before)} (changement annulé du ${rules.frDate(localIsoDate(new Date()))})`,
        }]));
        if (tableExists(db, 'reservation_refund_lines')) {
          db.prepare(`UPDATE reservation_refund_lines SET vatRate = ? WHERE bucket != 'touristTax'
            AND refundId IN (SELECT id FROM reservation_refunds WHERE reservationId = ?)`).run(before.rate, row.id);
        }
      }
    }
    const previous = remaining[remaining.length - 1];
    db.prepare("UPDATE reservations SET vatPeriodId = ? WHERE vatPeriodId = ? AND kind = 'devis'").run(previous.id, target.id);
    db.prepare('DELETE FROM vat_periods WHERE id = ?').run(target.id);
    repriceable(db, db.prepare(`SELECT * FROM reservations WHERE id IN (${placeholders(restored.length ? restored.map((r) => r.row.id) : [0])})`)
      .all(...(restored.length ? restored.map((r) => r.row.id) : [0]))).forEach((row) => resaveKeepingPrice(db, row));
    vatRegimeModel.syncMirror(db);
  })();
  return { ok: true };
}

module.exports = { previewSwitch, applySwitch, readState, deletePeriod, repriceStaysOfPeriod };
