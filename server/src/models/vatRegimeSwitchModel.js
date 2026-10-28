/**
 * Switching the VAT regime (specs/vat-optional-mode.md rules 14-19, 24-28): the preview of a switch, the
 * switch itself, and the undo of an unused or not-yet-started one. A switch is one transaction that
 * inserts a period, moves the reservations its scope names, and re-prices the stays whose proportional
 * tourist tax the regime moves with a TARGETED write (rule 27): the engine's figures under the old and
 * the new period are compared, the stay is accepted only when every non-tax figure is unchanged, and only
 * an allowlist of columns is written. The preview is the same computation played in a savepoint, so what
 * the dialog announces is what the switch does.
 *
 * Every function takes the database. The leaf `vatRegimeModel` reads; this module writes, and so may
 * call the pricing engine.
 */

const vatRegimeModel = require('./vatRegimeModel');
const rules = require('../utils/vatRegime');
const { isTouristTaxFrozen } = require('../utils/touristTaxFreeze');
const { comptaCollected } = require('../utils/reservationSettlement');
const { calculateReservationQuote } = require('../utils/pricing');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const { staleLinks } = require('../utils/ledgerLinks');
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

// Rule 27 — what the regime must leave alone: if any of these moves between the engine's figures under
// the old and the new period, the stay was priced under another rule and keeps its stored figures.
const NON_TAX_FIGURES = ['finalPrice', 'totalPrice', 'depositAmount', 'discountAmount', 'optionsTotal', 'resourcesTotal',
  'accommodationAdjustedPrice', 'engineFinalPrice', 'platformCommissionAmount', 'acompteCommissionAmount',
  'extraGuestSurcharge', 'depositDueDate', 'balanceDueDate'];
// The only columns a re-price writes (besides updatedAt and the history line): the tax and the amounts it rides on.
const ALLOWLIST = ['touristTaxTotal', 'balanceAmount', 'complementAmount'];
const FIGURE_OF = { touristTaxTotal: 'touristTaxTotal', balanceAmount: 'balanceAmount', complementAmount: 'complementAmount' };

const hasInstallmentPlan = (db, id) => tableExists(db, 'reservation_installments')
  && Boolean(db.prepare('SELECT 1 FROM reservation_installments WHERE reservationId = ? LIMIT 1').get(id));

const engineQuote = (db, row) => {
  const quote = calculateReservationQuote(buildReservationEngineInput(db, row));
  return quote && !quote.error ? quote : null;
};

/** The engine's quotes of these stays under their CURRENT period: call it before moving them. */
function quotesBefore(db, rows) {
  return new Map(rows.map((row) => [row.id, engineQuote(db, row)]));
}

/**
 * Rule 27 — what re-pricing a stay would write, given its quote before the move and the stay as it now is
 * (already under its new period). → { id, ok: false } when the stay keeps its figures (a figure other than
 * the tax moved, or no quote), else { id, ok: true, before, after } over the allowlisted columns, each
 * stored figure shifted by what the engine's own figure shifted by.
 */
function planReprice(db, row, quoteBefore) {
  const stored = db.prepare('SELECT * FROM reservations WHERE id = ?').get(row.id);
  // Rule 27 — a stay with an installment plan: no installment carries the tax, so it is not re-priced.
  if (hasInstallmentPlan(db, row.id)) return { id: row.id, ok: false, reason: 'plan' };
  const after = engineQuote(db, stored);
  if (!quoteBefore || !after) return { id: row.id, ok: false };
  if (NON_TAX_FIGURES.some((key) => JSON.stringify(quoteBefore[key]) !== JSON.stringify(after[key]))) return { id: row.id, ok: false };
  const before = {};
  const next = {};
  for (const column of ALLOWLIST) {
    const shift = round2(Number(after[FIGURE_OF[column]] || 0) - Number(quoteBefore[FIGURE_OF[column]] || 0));
    if (Math.abs(shift) <= TAX_EPSILON) continue;
    before[column] = Number(stored[column] || 0);
    next[column] = round2(Number(stored[column] || 0) + shift);
  }
  return { id: row.id, ok: true, before, after: next };
}

/** Rule 27 — writes a plan: the allowlisted columns, updatedAt, and one history line. */
function writePlan(db, plan) {
  const columns = Object.keys(plan.after);
  if (!columns.length) return;
  db.prepare(`UPDATE reservations SET ${columns.map((c) => `${c} = ?`).join(', ')}, updatedAt = datetime('now') WHERE id = ?`)
    .run(...columns.map((c) => plan.after[c]), plan.id);
  db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)').run(plan.id, 'update', JSON.stringify(
    columns.map((c) => ({ field: c, label: c === 'touristTaxTotal' ? 'Taxe de séjour' : (c === 'balanceAmount' ? 'Solde' : 'Complément'), from: plan.before[c], to: plan.after[c] })),
  ));
}

/**
 * Rule 32 — the open links whose amount no longer matches their bucket once these stays carry the planned
 * figures: the stays' own links and those of their converted devis. `figures` maps a stay id to the figures
 * written (or about to be). Pure read.
 */
function linksOutOfDate(db, plans) {
  if (!plans.length || !tableExists(db, 'payment_links')) return [];
  const out = [];
  for (const plan of plans.filter((p) => p.ok && Object.keys(p.after).length)) {
    const stored = db.prepare('SELECT * FROM reservations WHERE id = ?').get(plan.id);
    const stay = { ...stored, ...plan.after };
    const devisIds = db.prepare("SELECT id FROM reservations WHERE kind = 'devis' AND convertedReservationId = ?").all(plan.id).map((r) => r.id);
    const owners = [plan.id, ...devisIds];
    const open = db.prepare(`SELECT * FROM payment_links WHERE status = 'open' AND reservationId IN (${placeholders(owners)}) ORDER BY id`).all(...owners);
    // Rule 34 — only the links THIS write makes stale: one that already disagreed with its bucket is left alone.
    const staleBefore = new Set(staleLinks(open, stored).map((l) => l.id));
    out.push(...staleLinks(open, stay).filter((l) => !staleBefore.has(l.id)));
  }
  return out;
}

/** Rule 32 — retires those links (inside the transaction); the provider is told after the commit. */
function retireLinks(db, links) {
  const retire = db.prepare("UPDATE payment_links SET status = 'cancelled', remoteCancelPendingAt = ?, cancelReason = 'amount-changed' WHERE id = ? AND status = 'open'");
  const at = new Date().toISOString();
  return links.filter((link) => retire.run(link.providerLinkId ? at : null, link.id).changes > 0)
    .map((link) => ({ ...link, status: 'cancelled', remoteCancelPendingAt: link.providerLinkId ? at : null, cancelReason: 'amount-changed' }));
}

/** After the commit: tell each provider (never inside a transaction); a refusal is retried by the poll. */
function deactivateAfterCommit(links) {
  if (!links.length) return;
  setImmediate(() => {
    try {
      const { deactivateAbandonedLinks } = require('../utils/paymentLinkDeactivation');
      Promise.resolve(deactivateAbandonedLinks(links, { paymentLinksModel: require('./paymentLinksModel') })).catch((err) => {
        console.error('[vat-regime] link deactivation:', err && err.message ? err.message : err);
      });
    } catch (err) {
      console.error('[vat-regime] link deactivation:', err && err.message ? err.message : err);
    }
  });
}

/**
 * Rule 9 + 27 — the retroactive rate edit: the rate of the period in force is written, and the stays of that
 * period whose tax the rate moves are re-priced like a switch's. → { notRepriced: [ids], retiredLinks } — the caller
 * passes `retiredLinks` to `deactivateAfterCommit` once its own transaction has committed.
 */
function editRateInForce(db, rate) {
  let retired = [];
  const result = db.transaction(() => {
    const current = vatRegimeModel.inForce(db);
    const rows = current ? repriceable(db, db.prepare("SELECT * FROM reservations WHERE kind = 'reservation' AND vatPeriodId = ?").all(current.id)) : [];
    const before = quotesBefore(db, rows);
    const written = vatRegimeModel.setRateInForce(db, rate);
    if (!written.ok) return { ...written, notRepriced: [] };
    const plans = rows.map((row) => planReprice(db, row, before.get(row.id)));
    retired = retireLinks(db, linksOutOfDate(db, plans));
    plans.filter((p) => p.ok).forEach((p) => writePlan(db, p));
    return { ok: true, notRepriced: plans.filter((p) => !p.ok).map((p) => p.id) };
  })();
  // The caller's own transaction may still be open: it tells the providers once it has committed.
  return { ...result, retiredLinks: retired };
}

function openLinksOf(db, ids) {
  if (!ids.length || !tableExists(db, 'payment_links')) return 0;
  return db.prepare(`SELECT COUNT(*) AS n FROM payment_links WHERE status = 'open' AND reservationId IN (${placeholders(ids)})`).get(...ids).n;
}

/**
 * Rule 17 — the exact effects of a switch, without making it. → { errors } or { preview: { fingerprint,
 * reassigned, collected, touristTaxChanged, touristTaxDelta, touristTaxKept, openLinks, linksReplaced (open links whose amount no longer matches),
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
  const before = quotesBefore(db, movable);

  let taxDelta = 0;
  let devisDrafts = 0;
  const taxChangedIds = [];
  let notRepriced = 0;
  let planStays = 0;
  let plans = [];
  let staleOnes = [];
  db.exec('SAVEPOINT vat_regime_preview');
  try {
    const periodId = Number(db.prepare(`INSERT INTO vat_periods (regime, rate, legalMention, basis, effectiveFrom)
      VALUES (@regime, @rate, @legalMention, @basis, @effectiveFrom)`).run(candidate).lastInsertRowid);
    if (changed.length) db.prepare(`UPDATE reservations SET vatPeriodId = ? WHERE id IN (${placeholders(changed.map((r) => r.id))})`).run(periodId, ...changed.map((r) => r.id));
    plans = movable.map((row) => planReprice(db, row, before.get(row.id)));
    for (const plan of plans) {
      if (plan.reason === 'plan') { planStays += 1; continue; }
      if (!plan.ok) { notRepriced += 1; continue; }
      const delta = plan.after.touristTaxTotal == null ? 0 : plan.after.touristTaxTotal - plan.before.touristTaxTotal;
      if (Math.abs(delta) <= TAX_EPSILON) continue;
      taxChangedIds.push(plan.id);
      taxDelta += delta;
    }
    staleOnes = linksOutOfDate(db, plans);
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
  const replaced = staleOnes.length;
  const changedSet = new Set(changedIds);
  const replacedOwnIds = new Set(staleOnes.filter((l) => changedSet.has(l.reservationId)).map((l) => l.id));
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
      openLinks: Math.max(0, openLinksOf(db, changedIds) - replacedOwnIds.size),
      linksReplaced: replaced,
      exportMonths,
      devisDrafts,
      notRepriced,
      planStays,
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

  let retired = [];
  const result = db.transaction(() => {
    const { preview, errors } = previewSwitch(db, input, { today });
    if (errors) return { errors };
    if (!fingerprint || preview.fingerprint !== fingerprint) return { stale: true };
    if (preview.needsAcknowledgement && acknowledged !== true) return { errors: { acknowledged: 'Confirmation requise' } };

    const periods = vatRegimeModel.listPeriods(db);
    const candidate = rules.periodFromInput(input);
    const repricedRows = repriceable(db, db.prepare(`SELECT * FROM reservations WHERE id IN (${placeholders(preview.changedIds.length ? preview.changedIds : [0])})`).all(...(preview.changedIds.length ? preview.changedIds : [0])));
    const repriced = { rows: repricedRows, before: quotesBefore(db, repricedRows) };
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
    const plans = repriced.rows.map((row) => planReprice(db, row, repriced.before.get(row.id)));
    retired = retireLinks(db, linksOutOfDate(db, plans));
    plans.filter((p) => p.ok).forEach((p) => writePlan(db, p));
    db.prepare('UPDATE vat_periods SET repriced = ? WHERE id = ?').run(JSON.stringify(Object.fromEntries(plans.filter((p) => p.ok && Object.keys(p.after).length).map((p) => [p.id, { before: p.before, after: p.after }]))), periodId);
    const notRepriced = plans.filter((p) => !p.ok).map((p) => p.id);
    vatRegimeModel.syncMirror(db);
    return { ok: true, period: { ...period }, reassigned: preview.reassigned, notRepriced, retiredLinks: retired };
  })();
  deactivateAfterCommit(result.retiredLinks || []);
  return result;
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
  const stored = db.prepare('SELECT movedFrom, repriced FROM vat_periods WHERE id = ?').get(target.id);
  const parse = (text) => { try { return JSON.parse(text || '{}') || {}; } catch { return {}; } };
  const movedFrom = parse(stored && stored.movedFrom);
  const repricedBy = parse(stored && stored.repriced);
  let retired = [];
  const remaining = periods.filter((p) => p.id !== target.id);

  // Rule 26 — a re-priced stay that was paid or declared since cannot be taken back: the books and the
  // tourist-tax return would disagree with the money. The way back is a new switch.
  const settled = Object.keys(repricedBy).map(Number).map((stayId) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(stayId))
    .filter((row) => row && row.vatPeriodId === target.id
      && (isTouristTaxFrozen(db, row) || Number(row.balancePaid || 0) === 1 || Number(row.complementPaid || 0) === 1));
  if (settled.length) {
    return { error: 'stay_settled', stays: settled.map((row) => row.reservationNumber || String(row.id)) };
  }

  const notRepriced = [];
  db.transaction(() => {
    const rows = db.prepare("SELECT * FROM reservations WHERE vatPeriodId = ? AND kind IN ('reservation', 'cancelled')").all(target.id);
    const movedIds = rows.map((r) => r.id);
    // Rule 26 — a stay born under the period since (not in `movedFrom`) is priced under the regime it falls
    // back to by the same targeted write, with the same refusals (frozen, paid, plan: reported, not written).
    const bornRows = repriceable(db, rows.filter((r) => movedFrom[r.id] == null));
    const bornBefore = quotesBefore(db, bornRows);
    const put = db.prepare('UPDATE reservations SET vatPeriodId = ? WHERE id = ?');
    const insertHistory = db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)');
    for (const row of rows) {
      const before = movedFrom[row.id] != null && remaining.some((p) => p.id === Number(movedFrom[row.id]))
        ? remaining.find((p) => p.id === Number(movedFrom[row.id]))
        : rules.pickPeriod(remaining, { bookingDay: rules.bookingDayOf(row.createdAt), startDate: row.startDate });
      put.run(before.id, row.id);
      if (before.regime !== target.regime || Number(before.rate) !== Number(target.rate)) {
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
    // Rule 26 — exactly the stays the switch re-priced get their figures back (what they hold now, less what the
    // switch added); a stay it skipped is not touched.
    const plans = [];
    for (const id of movedIds) {
      const record = repricedBy[id];
      if (!record) continue;
      const current = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
      const before = {};
      const after = {};
      for (const column of Object.keys(record.after)) {
        before[column] = Number(current[column] || 0);
        after[column] = round2(Number(current[column] || 0) - (record.after[column] - record.before[column]));
      }
      plans.push({ id, ok: true, before, after });
    }
    const born = bornRows.map((row) => planReprice(db, row, bornBefore.get(row.id)));
    notRepriced.push(...born.filter((plan) => !plan.ok).map((plan) => plan.id));
    plans.push(...born.filter((plan) => plan.ok));
    retired = retireLinks(db, linksOutOfDate(db, plans));
    plans.forEach((plan) => writePlan(db, plan));
    vatRegimeModel.syncMirror(db);
  })();
  deactivateAfterCommit(retired);
  return { ok: true, notRepriced };
}

module.exports = { previewSwitch, applySwitch, readState, deletePeriod, editRateInForce, deactivateAfterCommit, __test: { planReprice, ALLOWLIST } };
