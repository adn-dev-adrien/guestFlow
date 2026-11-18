/**
 * The bank reconciliation, end to end (specs/qonto-bank-reconciliation.md): read the credits, expect the
 * receipts of the fiches, propose, state, and — on the operator's confirmation — mark the fiche.
 *
 * Fat backend: every figure, state, wording and allowed action of the page and of the fiche's card is
 * computed here; the client renders. Methods return `{ status, body }`, the routes only send them.
 */

const { buildProposals, classify, DEFAULT_PATTERNS, DEFAULT_BATCH_PLATFORMS } = require('./matcher');
const { stateOfReceipt, trancheDaysLate, fixText, isGap, euros } = require('./receiptStates');
const { expectedReceipts, expectedReceiptsOfReservation, RESERVATION_SQL, installmentsReader, settlementsReader } = require('./expectedReceipts');
const { cardCandidates, salesSince, sourcesOfSales } = require('./mollieCardSources');
const { ficheCredits, creditReceipts, anchorOf } = require('./ficheCredits');
const { allocateFifo, summarize, validatePairs } = require('./allocation');
const { runAutoConfirm } = require('./autoConfirm');
const { decorateRows } = require('./deadlineDecorator');
const { settlementReferenceOf, isMollieCredit } = require('./mollieSettlements');
const { addDays: addDaysIso, splitIdOf, PAID_LINK_FILTER } = require('./molliePaymentSplits');
const { trancheView, scheduleView, TRANCHE_LABELS, immediateShareLabel, percentLabel } = require('./mollieTranches');
const { mollieJournal } = require('./mollieJournal');
const { randomUUID } = require('crypto');
const sdk = require('../../sdk');

const standaloneSales = sdk.coreModule('standaloneSales');
// A card batch is named after the day of its payments, credited that day or a few days later.
const BATCH_LOOKBACK_DAYS = 7;
const shiftDay = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

const MIN_READ_GAP_MS = 60 * 1000;
const JOURNAL_CACHE_MS = 5 * 1000;
const RECENT_DAYS = 30;
const CREDIT_WINDOW_DAYS = 31;
const MAX_BATCH_CREDITS = 10;
const FILTERS = ['gaps', 'proposed', 'unmatched', 'reconciled', 'auto'];
const CONFIDENCE_LABELS = { sur: 'sûr', probable: 'probable', verifier: 'à vérifier' };
const DEFAULT_ACQUIRING_FEE = Object.freeze({ percent: 1.4, fixedCents: 25 });
const DEFAULT_CARD_FEE_PERCENT = 2.8;

const { day } = require('./dates');
const frDate = (iso) => (day(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const keyOf = (r) => `${r.reservationId}|${r.ledgerKey}`;
// Rule 13 — late whether or not a proposal waits: the state may be « À confirmer », the tranche is late all the same.
const isLateReserve = (i) => Boolean(i.mollie) && i.mollie.tranche === 'retenue' && Boolean(i.mollie.late);
const parseJson = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };

// Rule 12 — the identifiers of a credit: Qonto's transaction id, and for Mollie the settlement reference and the payment.
const refsOf = (t, molliePayment = null) => ({
  qonto: t.qontoReference || (t.id ? String(t.id) : null),
  mollieSettlement: isMollieCredit(t) ? settlementReferenceOf(t) : null,
  molliePayment,
});
const baseBankSide = (t, molliePayment = null) => ({
  transactionId: t.id, amountCents: t.amountCents, date: day(t.settledAt), dateLabel: frDate(t.settledAt),
  counterparty: t.counterpartyName || t.label || '', reference: t.reference || t.note || '',
  refs: refsOf(t, molliePayment),
});

// Rule 4 — the one definition of a tranche's words and lateness, shared by the whole pass and the per-fiche read.
const mollieMeta = (r, lines, today) => {
  const daysLate = lines.length === 0 ? trancheDaysLate(r, today) : 0;
  return {
    ...r.mollie, label: TRANCHE_LABELS[r.mollie.tranche](r.mollie), baseKey: r.baseKey, expectedDateLabel: frDate(r.expectedDate),
    late: daysLate > 0, daysLate: daysLate > 0 ? daysLate : 0,
  };
};

/**
 * @param {object} deps
 * @param {object} deps.db
 * @param {object} deps.settings         ctx.settings (get, set)
 * @param {object} deps.transactions     bankTransactionsModel
 * @param {object} deps.model            reconciliationModel
 * @param {object} deps.writer           ficheWriter
 * @param {Function} deps.read           `() → Promise<{ok, read, error?}>` — reads Qonto into `transactions`
 * @param {() => boolean} deps.connected
 * @param {() => boolean} deps.qontoConfigured  the Qonto credentials are there (rule 50: the job waits for them)
 * @param {Function} deps.withQonto      `(fn) → Promise`
 * @param {object} deps.core             `{ buildLedger, parseGroup, listLinks, platformDisplay, todayIso }`
 * @param {object} [deps.splits]         the Mollie splits model (`sync`, `forLink`, `forSource`) — specs/mollie-rolling-reserve-and-incoming-payments.md rule 1
 * @param {object} [deps.mollieSettlements] the settlements model (`byReference`) — rule 10
 * @param {object} [deps.mollie]         the optional Mollie connection (`status`, `sync`) — rules 14-17
 * @param {object} [deps.mollieStatements] the Mollie statements (`lineOf`) — specs/mollie-settlement-receipts.md rule 11
 */
// Hosting-h2 rule 68, reading of 2026-11-05 — the routes' wrap answers a throw with a 500: what `String()` cannot read stops
// here, and every other value keeps the refusal it always had.
const isName = (value) => typeof value === 'string' && value !== '';
const isScalar = (value) => typeof value === 'string' || typeof value === 'number';
const optionalScalar = (value) => value === undefined || value === null || isScalar(value);
const wrongShape = () => ({ status: 400, body: { error: 'Requête invalide.', code: 'INVALID_FIELD_TYPE' } });
const pairsRead = (pairs) => !Array.isArray(pairs) || pairs.every((p) => p && typeof p === 'object' && !Array.isArray(p)
  && optionalScalar(p.transactionId) && optionalScalar(p.reservationId) && optionalScalar(p.ledgerKey) && optionalScalar(p.amountCents));
const listRead = (list) => !Array.isArray(list) || list.every(isScalar);
const unknownReservation = () => ({ status: 404, body: { error: 'Réservation introuvable.', code: 'UNKNOWN_RESERVATION' } });
const unknownTransaction = () => ({ status: 404, body: { error: 'Virement introuvable.', code: 'UNKNOWN_TRANSACTION' } });

function createReconciliationController({ db, settings, transactions, model, writer, read, connected, qontoConfigured, withQonto, core, splits = null, mollieSettlements = null, mollie = null, mollieStatements = null }) {
  let lastAttemptAt = 0;
  // specs/mollie-settlement-receipts.md rule 11 — the statement of a Mollie credit rides on its bank side.
  const bankSide = (t, molliePayment = null) => ({ ...baseBankSide(t, molliePayment), statement: mollieStatements && isMollieCredit(t) ? mollieStatements.lineOf(t) : null });
  // One computed pass serves the journal of every month of a request (the synthesis asks month after month); any write drops it.
  let journalCache = null;

  const startDateOf = (today) => {
    const stored = day(settings.get('reconciliationStartDate'));
    if (stored) return stored;
    settings.set('reconciliationStartDate', today);
    return today;
  };

  /**
   * Rule 1 — what a read sees of the splits: the stored one, else a PROVISIONAL one derived in memory (same formula, the
   * settings in force now, never stored) for a payment seen paid with no `reservation.paid` event yet — a complement
   * link ended `noop`, a basket link, a double payment, a card taken on site. The sync stores the real one later.
   */
  const splitReaders = (cards = new Map()) => (splits ? {
    splitFor: (link) => splits.forLink(link.id) || splits.provisionalOfLink(link, settings),
    sourceSplit: (type, key) => splits.forSource(type, key) || cards.get(splitIdOf(type, key)) || null,
  } : { splitFor: undefined, sourceSplit: undefined });

  /** Rule 32 — the paid links of sales outside a stay (`saleRef`, no stay) paid on or after `startDate` (a Paris day). */
  function paidSaleLinks(startDate) {
    return db.prepare(`SELECT l.* FROM payment_links l WHERE l.saleRef IS NOT NULL AND l.reservationId IS NULL AND ${PAID_LINK_FILTER} ORDER BY l.paidAt, l.id`).all()
      .filter((l) => (day(l.paidAt) || '') >= startDate);
  }

  /** The provisional splits of the card payments recorded on site (from « CB sur place via Mollie depuis »), keyed by split id. */
  function provisionalCards({ rows, startDate, today, only = null }) {
    const cards = new Map();
    const since = splits ? day(settings.get('mollieCardOnSiteSince')) : null;
    if (!since) return cards;
    const { settlementsOf } = settlementsReader(db);
    cardCandidates({ rows, linksOf: core.listLinks, installmentsOf: installmentsReader(db, core.listInstallments), settlementsOf, startDate, today })
      .filter((c) => (only == null || Number(c.reservationId) === Number(only)) && day(c.paidAt) && day(c.paidAt) >= since)
      .forEach((c) => {
        const row = splits.provisional(c, settings);
        if (row) cards.set(splitIdOf(c.sourceType, c.sourceKey), row);
      });
    return cards;
  }

  /**
   * Rule 1 — the split of every paid link, and of every card payment taken on site (from « CB sur place via Mollie
   * depuis »), stored once with the settings of that moment. The ONLY writer of the splits besides the Mollie read: a
   * reading path never calls it (specs/mollie-rolling-reserve-and-incoming-payments.md rule 1, « no write on a read »).
   */
  function splitsSync({ startDate, today }) {
    lastSplitsSyncAt = Date.now();
    let candidates = [];
    let scope = null;
    if (day(settings.get('mollieCardOnSiteSince'))) {
      const rows = db.prepare(`${RESERVATION_SQL} ORDER BY r.endDate, r.id`).all(startDate);
      const { settlementsOf } = settlementsReader(db);
      candidates = cardCandidates({
        rows, linksOf: core.listLinks, installmentsOf: installmentsReader(db, core.listInstallments), settlementsOf, startDate, today,
      });
      scope = { reservationIds: new Set(rows.map((r) => Number(r.id))), salesFrom: startDate, salesTo: today };
    }
    return splits.sync({ settings, candidates, scope });
  }

  // A page that lists the reconciliation brings the splits up to date when a paid link has none yet, or every few minutes
  // (an on-site card payment has no event). The fiche, the quote preview and the dashboard tile never do: they read.
  const SPLITS_SYNC_EVERY_MS = 5 * 60 * 1000;
  let lastSplitsSyncAt = 0;
  const freshenSplitsNow = () => { journalCache = null; lastSplitsSyncAt = 0; freshenSplits(); };
  function freshenSplits() {
    if (!splits || !day(settings.get('reconciliationStartDate'))) return;
    if (Date.now() - lastSplitsSyncAt < SPLITS_SYNC_EVERY_MS && !splits.hasUnsplitLinks()) return;
    const today = core.todayIso();
    splitsSync({ startDate: day(settings.get('reconciliationStartDate')) || today, today });
  }

  const matcherSettings = () => {
    const custom = parseJson(settings.get('reconciliationPlatformPatterns'), {});
    const rates = {};
    try {
      db.prepare('SELECT name, commissionPercent FROM platforms').all().forEach((p) => { rates[p.name] = Number(p.commissionPercent) || 0; });
    } catch { /* no platforms table: no commission guess */ }
    const fee = parseJson(settings.get('reconciliationAcquiringFee'), null) || DEFAULT_ACQUIRING_FEE;
    const card = Number(settings.get('reconciliationCardFeePercent'));
    return {
      patterns: { ...DEFAULT_PATTERNS, ...custom },
      batchPlatforms: DEFAULT_BATCH_PLATFORMS,
      acquiringFee: fee,
      cardFeePercent: Number.isFinite(card) && card > 0 ? card : DEFAULT_CARD_FEE_PERCENT,
      commissionRates: rates,
      settlements: mollieSettlements ? mollieSettlements.byReference() : new Map(),
    };
  };

  const feeOf = (acquiringFee, grossCents) => Math.round(grossCents * (Number(acquiringFee.percent) || 0) / 100) + (Number(acquiringFee.fixedCents) || 0);
  const acquiringFeeOf = () => parseJson(settings.get('reconciliationAcquiringFee'), null) || DEFAULT_ACQUIRING_FEE;

  /**
   * Rule 4 — the reserve counts from the immediate tranche's real bank date once it is reconciled (`immediateDayOf`).
   * Rule 5 — the fees Mollie read from its settlements replace the estimate (the formula is only for a payment not read
   * yet); only the immediate share bears fees: a release is paid whole (rule 15, tolerance 0).
   */
  function decorateMollieReceipts(baseReceipts, immediateDayOf, acquiringFee) {
    const realFees = mollieSettlements && typeof mollieSettlements.realFees === 'function' ? mollieSettlements.realFees() : new Map();
    return baseReceipts.map((r) => {
      if (!r.mollie) return r;
      if (r.mollie.tranche !== 'retenue') {
        const fee = realFees.has(r.mollie.splitId) ? realFees.get(r.mollie.splitId) : feeOf(acquiringFee, r.mollie.paymentGrossCents);
        return { ...r, feeCents: fee };
      }
      const immediate = immediateDayOf(r);
      const at = immediate ? addDaysIso(immediate, r.mollie.holdDays) : r.expectedDate;
      return { ...r, expectedDate: at, dueDate: at, feeCents: 0 };
    });
  }

  /** One full pass over stored data: receipts, credits, proposals, states. Never calls Qonto. */
  function compute() {
    const today = core.todayIso();
    const startDate = startDateOf(today);
    const cfg = matcherSettings();
    const netOf = (c) => c - Math.round(c * (Number(cfg.acquiringFee.percent) || 0) / 100) - (Number(cfg.acquiringFee.fixedCents) || 0);

    const bankAccountId = settings.get('reconciliationBankAccountId');
    const txRows = bankAccountId ? transactions.listForAccount(bankAccountId) : [];
    const txById = new Map(txRows.map((t) => [t.id, t]));
    const lineRows = model.listLines();
    const outside = model.outsideIds();
    const discarded = model.discardedKeys();

    // Rule 1 (second half) — the sales outside a stay that went through Mollie have receipts of their own.
    const sales = splits ? salesSince(startDate, today) : [];
    const { splitFor, sourceSplit } = splitReaders(provisionalCards({
      rows: splits && day(settings.get('mollieCardOnSiteSince')) ? db.prepare(`${RESERVATION_SQL} ORDER BY r.endDate, r.id`).all(startDate) : [], startDate, today,
    }));
    // Rule 32 (loop t10 D10-2) — the paid links of sales outside a stay (no stay to list them under), from the reconciliation start.
    const saleLinks = splits ? paidSaleLinks(startDate) : [];
    const baseReceipts = expectedReceipts({
      db, startDate, today, buildLedger: core.buildLedger, parseGroup: core.parseGroup, listLinks: core.listLinks, listInstallments: core.listInstallments, splitFor, sourceSplit, sales, saleLinks,
    });

    const allocatedOf = new Map();
    const linesByReceipt = new Map();
    lineRows.forEach((l) => {
      allocatedOf.set(l.transactionId, (allocatedOf.get(l.transactionId) || 0) + l.amountCents);
      const k = `${l.reservationId}|${l.ledgerKey}`;
      if (!linesByReceipt.has(k)) linesByReceipt.set(k, []);
      const tx = txById.get(l.transactionId);
      linesByReceipt.get(k).push({ ...l, settledAt: tx ? tx.settledAt : null });
    });

    const receipts = decorateMollieReceipts(baseReceipts, (r) => (linesByReceipt.get(`${r.reservationId}|${r.baseKey}#immediat`) || [])
      .map((l) => day(l.settledAt)).filter(Boolean).sort().pop(), cfg.acquiringFee);

    const matchable = txRows.filter((t) => t.currency === 'EUR' && t.settledAt && !outside.has(t.id))
      .map((t) => ({ ...t, remainingCents: t.amountCents - (allocatedOf.get(t.id) || 0) }))
      .filter((t) => t.remainingCents > 0);

    const openReceipts = receipts.map((r, order) => {
      const lines = linesByReceipt.get(keyOf(r)) || [];
      const covered = lines.reduce((s, l) => s + l.amountCents, 0);
      const isLink = r.channel === 'link';
      // A Mollie tranche arrives in one credit, short of its fees at most (rule 5): one line settles it, like a link.
      const isMollie = Boolean(r.mollie);
      const open = isLink || isMollie ? (lines.length > 0 ? 0 : r.expectedCents) : Math.max(0, r.expectedCents - covered);
      // A platform payout the fiche does not carry yet has no expected amount: the credit is the payout (v1 rule 36).
      const unbounded = r.channel.startsWith('platform:') && !r.payoutRecorded;
      const expectedBank = isLink ? netOf(r.expectedCents) : r.expectedCents;
      // The credit of a payout the fiche does not carry yet is its payout, but never more than the stay can pay
      // out: its gross (the platform's commission is not known to the cent), plus 1 % (review 2026-10-28).
      const unboundedCap = Math.round(Math.max(0, r.grossCents) * 1.01);
      return {
        ...r, key: keyOf(r), openCents: open, order, anchor: anchorOf(r), unbounded,
        fitCents: r.grossCents, capCents: unbounded ? unboundedCap : open, checkCap: !isLink,
        needCents: unbounded ? unboundedCap : Math.max(0, expectedBank - covered), tolerance: isMollie ? (r.feeCents || 0) : (isLink ? Math.max(1, lines.length + 1) : 0),
        alreadyCovered: isMollie ? lines.length > 0 : !unbounded && r.expectedCents > 0 && covered >= r.expectedCents,
      };
    });
    // specs/resource-booking-pricing-and-invoicing.md rule 20 — the card sales made outside any stay, over the days the
    // credits cover.
    const days = matchable.map((t) => String(t.settledAt).slice(0, 10)).sort();
    // A sale that went through Mollie (rule 1) is in a Mollie credit, never in the day's card batch.
    // Rule 33 — the same source per sale as the receipts: each invoice number on one day of its document.
    const throughMollie = (source) => Boolean(sourceSplit && sourceSplit(source.sourceType, source.sourceKey));
    const standalone = days.length
      ? sourcesOfSales(standaloneSales.list({ from: shiftDay(days[0], -BATCH_LOOKBACK_DAYS), to: days[days.length - 1] }), today)
        .filter((source) => !throughMollie(source)).map((source) => source.sale) : [];
    const { byTransaction } = buildProposals({ transactions: matchable, receipts: openReceipts, discarded, settings: cfg, standalone });

    const proposalsByReceipt = new Map();
    const alternativesByReceipt = new Map();
    Object.values(byTransaction).forEach((slot) => {
      if (slot.proposal) slot.proposal.allocations.forEach((a) => proposalsByReceipt.set(`${a.reservationId}|${a.ledgerKey}`, slot.proposal));
      slot.alternatives.forEach((p) => p.allocations.forEach((a) => {
        const k = `${a.reservationId}|${a.ledgerKey}`;
        if (!alternativesByReceipt.has(k)) alternativesByReceipt.set(k, []);
        alternativesByReceipt.get(k).push(p);
      }));
    });

    const receiptByKey = new Map(receipts.map((r) => [keyOf(r), r]));

    // Rule 19 — the other receipts confirmed together with a line (same credit, same group).
    const headingOf = (reservation) => (reservation.saleKey && !reservation.hasClient ? '' : (reservation.clientName || reservation.saleLabel || 'Client'));
    const labelOf = (l) => { const o = receiptByKey.get(`${l.reservationId}|${l.ledgerKey}`); return o ? { reservationId: l.reservationId, ledgerKey: l.ledgerKey, label: o.label, clientName: o.reservation.clientName, clientHeading: headingOf(o.reservation) } : null; };
    const coveredWith = (line) => (line.groupId ? lineRows.filter((o) => o.groupId === line.groupId && o.transactionId === line.transactionId && o.id !== line.id
      && `${o.reservationId}|${o.ledgerKey}` !== `${line.reservationId}|${line.ledgerKey}`).map(labelOf).filter(Boolean) : []);

    const items = receipts.map((r) => {
      const k = keyOf(r);
      const lines = linesByReceipt.get(k) || [];
      const primary = proposalsByReceipt.get(k) || null;
      const alts = alternativesByReceipt.get(k) || [];
      const st = stateOfReceipt({ receipt: r, lines, hasProposal: Boolean(primary) || alts.length > 0, today, netOf });
      const proposalTx = primary ? txById.get(primary.transactionId) : null;
      const mine = primary ? primary.allocations.find((a) => keyOf(a) === k) : null;
      const alsoCovers = primary ? primary.allocations.filter((a) => keyOf(a) !== k).map((a) => {
        const other = receiptByKey.get(keyOf(a));
        return other ? { reservationId: a.reservationId, ledgerKey: a.ledgerKey, label: other.label, clientName: other.reservation.clientName, clientHeading: headingOf(other.reservation) } : null;
      }).filter(Boolean) : [];
      const showProposal = primary && lines.length === 0;
      return {
        key: k,
        reservation: { ...r.reservation, platformDisplay: core.platformDisplay(r.reservation.platform) },
        ledgerKey: r.ledgerKey, label: r.label, channel: r.channel,
        // A sale outside a stay has no fiche to wait on and, without a client, no name besides its label (loop t11 UI11-2).
        expectedWording: r.reservation.saleKey ? 'Attendu' : 'La fiche attend',
        clientHeading: headingOf(r.reservation),
        expectedCents: r.expectedCents, expectedDate: r.expectedDate, expectedDateLabel: frDate(r.expectedDate),
        paid: r.paid, paidDate: r.paidDate,
        state: st.state, stateLabel: st.stateLabel, tone: st.tone, isGap: isGap(st.state),
        gapCents: st.gapCents, receivedCents: st.receivedCents,
        fixText: fixText({ ...st, receipt: r }),
        mollie: r.mollie ? mollieMeta(r, lines, today) : null,
        bank: lines.map((l) => ({
          ...bankSide(txById.get(l.transactionId) || { id: l.transactionId, amountCents: l.amountCents, settledAt: l.settledAt }, r.mollie ? r.mollie.molliePaymentId : null),
          allocatedCents: l.amountCents, auto: Number(l.auto) === 1, alsoCovers: coveredWith(l),
        })),
        allocatedCents: lines.reduce((sum, l) => sum + l.amountCents, 0),
        proposal: showProposal && proposalTx ? {
          id: primary.id, confidence: primary.confidence, confidenceLabel: CONFIDENCE_LABELS[primary.confidence], reason: primary.reason,
          source: primary.source, allocations: primary.allocations, amountCents: mine ? mine.amountCents : primary.allocations[0].amountCents,
          bank: bankSide(proposalTx), alsoCovers,
          parts: primary.parts ? primary.parts.map((x) => ({ ...bankSide(txById.get(x.transactionId)), amountCents: x.amountCents })) : null,
          needsShares: Boolean(primary.needsShares), pairs: pairsOfProposal(primary),
        } : null,
        alternatives: lines.length === 0 ? alts.filter((p) => !primary || p.id !== primary.id).slice(0, 4).map((p) => {
          const t = txById.get(p.transactionId);
          return { proposalId: p.id, confidence: p.confidence, confidenceLabel: CONFIDENCE_LABELS[p.confidence], allocations: p.allocations, bank: bankSide(t) };
        }) : [],
        canUndo: lines.length > 0,
        // The provider cannot reopen a payment link it closed: « Défaire » on an installment says so first (rule 33).
        undoWarning: lines.length > 0 && r.installmentId && core.listLinks(r.reservationId).some((l) => l.type === 'installment' && Number(l.installmentId) === Number(r.installmentId))
          ? 'Le lien de paiement de cette échéance reste annulé ; en envoyer un nouveau depuis la fiche.' : null,
        // Rule 24 — a platform credit below the expected payout: the gap can be declared as a penalty.
        declarePenalty: (st.state === 'amount_gap' || st.state === 'partial') && r.channel.startsWith('platform:') && r.ledgerKey === 'balance' && r.payoutRecorded && st.gapCents < 0
          ? { amountCents: -st.gapCents, amount: -st.gapCents / 100 } : null,
      };
    });

    const windowStart = addDays(startDate, -CREDIT_WINDOW_DAYS);
    const credits = txRows
      .filter((t) => day(t.settledAt) && day(t.settledAt) >= windowStart)
      .map((t) => {
        const remaining = t.amountCents - (allocatedOf.get(t.id) || 0);
        const slot = byTransaction[t.id];
        const cls = t.currency === 'EUR' ? classify(t, cfg) : { kind: 'other' };
        let status;
        if (outside.has(t.id)) status = 'outside';
        else if (remaining <= 0) status = 'reconciled';
        else if (slot && slot.proposal) status = 'proposed';
        else if (cls.kind === 'platform' || cls.kind === 'mollie') status = 'unmatched';
        else status = 'other';
        return {
          ...bankSide(t), remainingCents: Math.max(0, remaining), currency: t.currency, status, kind: cls.kind,
          platform: cls.platform || null,
          note: status === 'unmatched'
            ? (cls.kind === 'mollie' ? 'Versement Mollie qu\'aucun paiement par carte ne couvre : lien payé manquant ou montant différent.'
              : 'Versement attendu d\'une plateforme qu\'aucune fiche ne réclame : fiche manquante ou montant mal saisi.') : null,
        };
      });

    const counts = {
      gaps: items.filter((i) => i.isGap).length,
      proposed: items.filter((i) => i.state === 'proposed').length,
      unmatched: credits.filter((c) => c.status === 'unmatched').length,
      reconciled: items.filter((i) => i.state === 'reconciled').length,
      waiting: items.filter((i) => i.state === 'waiting').length,
      other: credits.filter((c) => c.status === 'other' || c.status === 'outside').length,
    };
    counts.todo = counts.gaps + counts.proposed + counts.unmatched;
    const receiptsByKey = new Map(openReceipts.map((r) => [r.key, r]));
    return {
      today, startDate, bankAccountId, items, credits, counts, txById, receipts, allocatedOf, linesByReceipt,
      openReceipts, receiptsByKey, available: matchable, byTransaction, bankSide,
    };
  }

  /** Every stored credit by id, with what is left to allocate — the validation's view (zero left included). */
  const creditIndex = (data) => new Map([...data.txById.values()].map((t) => [String(t.id), {
    transactionId: String(t.id), remainingCents: t.amountCents - (data.allocatedOf.get(t.id) || 0),
    settledAt: t.settledAt, dateLabel: frDate(t.settledAt),
  }]));

  /** A credit as the dialogs read it: bank fields for the search, `proposedElsewhere` for the badge. */
  const creditEntity = (data, t, forReservationId) => {
    const slot = data.byTransaction[t.id];
    const elsewhere = Boolean(slot && slot.proposal && slot.proposal.allocations.every((a) => a.reservationId !== forReservationId));
    // A credit the matcher proposes to THIS fiche always counts as plausible (review 2026-10-28): its key is the receipt it fits.
    const mine = slot && slot.proposal ? slot.proposal.allocations.find((a) => a.reservationId === forReservationId) : null;
    return {
      ...t, ...data.bankSide(t), transactionId: String(t.id), proposedElsewhere: elsewhere,
      proposedHereKey: mine ? `${mine.reservationId}|${mine.ledgerKey}` : null,
    };
  };

  /** The primary proposal of every credit, by id (rule 13). */
  const proposalsOf = (data) => new Map(Object.values(data.byTransaction).filter((slot) => slot.proposal).map((slot) => [slot.proposal.id, slot.proposal]));
  const pairsOfProposal = (p) => p.pairs || p.allocations.map((a) => ({ transactionId: p.transactionId, reservationId: a.reservationId, ledgerKey: a.ledgerKey, amountCents: a.amountCents }));

  /** A refusal that is really « out of scope » says so (v1 wording). */
  function explainErrors(data, pairs, errors) {
    return errors.map((e) => {
      const m = /^pairs\.(\d+)$/.exec(e.field || '');
      if (e.code !== 'UNKNOWN_RECEIPT' || !m) return e;
      const row = db.prepare('SELECT endDate FROM reservations WHERE id = ?').get(Number(pairs[Number(m[1])].reservationId));
      return row && day(row.endDate) < data.startDate
        ? { ...e, code: 'RESERVATION_OUT_OF_SCOPE', message: 'Cette réservation est hors du périmètre du rapprochement.' } : e;
    });
  }

  /** The one write path of every confirmation: validate everything, then store every pair and mark the fiches, all or nothing. */
  function linkPairs({ pairs, user, legacy = false, enforceCap = false, auto = false, proposalId = null }) {
    const data = compute();
    const list = pairs.map((p) => ({ ...p, transactionId: String(p.transactionId) }));
    if (new Set(list.map((p) => p.transactionId)).size > MAX_BATCH_CREDITS) {
      return { status: 422, body: { error: `Au plus ${MAX_BATCH_CREDITS} virements à la fois.`, code: 'INVALID_ALLOCATION' } };
    }
    // A platform receipt never takes more than it expects (it would rewrite the payout of the fiche): the
    // « another amount » latitude of v1 rule 36 is for the own channels only.
    const capped = !proposalId && (enforceCap || list.some((p) => String((data.receiptsByKey.get(`${p.reservationId}|${p.ledgerKey}`) || {}).channel || '').startsWith('platform:')));
    const errors = explainErrors(data, list, validatePairs({ pairs: list, creditsById: creditIndex(data), receiptsByKey: data.receiptsByKey, enforceCap: capped }));
    if (errors.length > 0) {
      const [first] = errors;
      const status = first.code === 'UNKNOWN_TRANSACTION' ? 404 : (first.code === 'INVALID_ALLOCATION' && legacy ? 400 : 422);
      return { status, body: { error: first.message, code: first.code, errors } };
    }
    const shares = proposalId ? sharesRefusal(data, proposalId, list) : null;
    if (shares) return { status: 422, body: { error: shares, code: 'SHARES_DO_NOT_SUM' } };
    return writePairs({ data, list, user, auto });
  }

  /** Rule 18 — a grouped payout confirmed with typed shares: they must make the credit to the cent, and cover its receipts only. */
  function sharesRefusal(data, proposalId, list) {
    const found = proposalsOf(data).get(String(proposalId));
    if (!found || !found.needsShares) return null;
    const credit = data.txById.get(found.transactionId);
    const remaining = credit.amountCents - (data.allocatedOf.get(credit.id) || 0);
    const keys = new Set(found.allocations.map((a) => `${a.reservationId}|${a.ledgerKey}`));
    if (list.some((p) => p.transactionId !== found.transactionId || !keys.has(`${p.reservationId}|${p.ledgerKey}`))) {
      return 'Les parts doivent porter sur les séjours de ce versement.';
    }
    const sum = list.reduce((t, p) => t + p.amountCents, 0);
    if (sum === remaining) return null;
    return sum < remaining ? `Il manque ${euros(remaining - sum)} : les parts doivent faire ${euros(remaining)}.` : `Les parts dépassent le versement de ${euros(sum - remaining)} : elles doivent faire ${euros(remaining)}.`;
  }

  /**
   * Rule 34 — a platform balance whose stored lines now equal, to the cent, what its penalties leave to expect is marked
   * received (flag and date only: its payout is recorded, nothing else moves). A payout the fiche does not carry yet,
   * or an amount that does not match, is left to the operator.
   */
  function completeIfCovered(data, reservationId) {
    const receipt = data.receiptsByKey.get(`${reservationId}|balance`);
    if (!receipt || receipt.paid || receipt.unbounded || !receipt.channel.startsWith('platform:')) return false;
    const lines = data.linesByReceipt.get(receipt.key) || [];
    if (lines.length === 0 || lines.reduce((s, l) => s + l.amountCents, 0) !== receipt.expectedCents) return false;
    return db.transaction(() => writeReceipt(data, receipt, { user: SYSTEM_USER, auto: false, netOf: (c) => c }).written)();
  }

  /** The sweep of every read: a declaration the server missed the event of (stopped in between) completes here. */
  function completionSweep() {
    compute().openReceipts.filter((r) => r.ledgerKey === 'balance' && !r.paid && Number((db.prepare('SELECT platformPenaltyAmount AS p FROM reservations WHERE id = ?').get(r.reservationId) || {}).p) > 0)
      .forEach((r) => { completeIfCovered(compute(), r.reservationId); });
  }

  /** Marks the receipt received when its confirmed lines now cover it (v1 rules 34–37). */
  function writeReceipt(data, receipt, { user, auto = false, netOf }) {
    // Rule 11 — a Mollie tranche is already paid on the fiche (the webhook marked its échéance): confirming stores the lines only.
    if (receipt.mollie) return { written: false, reason: 'mollie' };
    const lines = model.linesOfReceipt(receipt.reservationId, receipt.ledgerKey)
      .map((l) => ({ ...l, settledAt: (data.txById.get(l.transactionId) || {}).settledAt }));
    const isLink = receipt.channel === 'link';
    // A platform payout the fiche does not carry yet has no expected amount: the credit is the payout (rule 36).
    const covered = lines.reduce((sum, l) => sum + l.amountCents, 0);
    return writer.writeIfComplete({
      receipt, lines, expectedBankCents: receipt.unbounded ? covered : (isLink ? netOf(receipt.expectedCents) : receipt.expectedCents),
      tolerance: isLink ? lines.length : 0, user, auto,
    });
  }

  function writePairs({ data, list, user, auto = false }) {
    journalCache = null;
    const marked = [];
    const notWritten = [];
    const cfg = matcherSettings();
    const netOf = (c) => c - Math.round(c * (Number(cfg.acquiringFee.percent) || 0) / 100) - (Number(cfg.acquiringFee.fixedCents) || 0);
    try {
      db.transaction(() => {
        const groupId = list.length > 1 ? randomUUID() : null;
        list.forEach((a) => model.addLine({
          transactionId: a.transactionId, reservationId: Number(a.reservationId), ledgerKey: String(a.ledgerKey),
          amountCents: a.amountCents, createdBy: auto ? null : (user && user.id ? user.id : null), auto, groupId,
        }));
        new Set(list.map((a) => `${a.reservationId}|${a.ledgerKey}`)).forEach((k) => {
          const receipt = data.receiptsByKey.get(k);
          const result = writeReceipt(data, receipt, { user, auto, netOf });
          if (result.error) { const err = new Error('FICHE_REFUSED'); err.refusal = result.error; throw err; }
          if (result.written) marked.push({ reservationId: receipt.reservationId, ledgerKey: receipt.ledgerKey, date: result.date, warning: result.warning || null });
          else notWritten.push({ reservationId: receipt.reservationId, ledgerKey: receipt.ledgerKey, reason: result.reason });
        });
      })();
    } catch (err) {
      if (err.refusal) return { status: err.refusal.status, body: { ...err.refusal.body, code: (err.refusal.body && err.refusal.body.code) || 'FICHE_REFUSED' } };
      throw err;
    }
    return { status: 201, body: { ok: true, marked, notWritten } };
  }

  const lastError = () => parseJson(settings.get('reconciliationLastError'), null);

  /** Rules 16-17 — the Mollie settlements of the stored credits; a failure is kept for the card and never stops the pass. */
  async function syncMollie() {
    if (!mollie || !mollie.configured()) return;
    const bankAccountId = settings.get('reconciliationBankAccountId');
    await mollie.sync({ credits: bankAccountId ? transactions.listForAccount(bankAccountId) : [], splits });
  }
  const SYSTEM_USER = Object.freeze({ id: null, role: 'admin' });

  /** Rules 20–21 — after a read, the certain matches confirm themselves (unless switched off). */
  function afterRead() {
    completionSweep();
    const { keys } = settings.get('reconciliationAutoConfirm') === '0'
      ? { keys: [] }
      : runAutoConfirm({ compute, confirm: ({ pairs }) => linkPairs({ pairs, user: SYSTEM_USER, auto: true }) });
    settings.set('reconciliationAutoConfirmed', JSON.stringify({ count: keys.length, keys, at: new Date().toISOString() }));
  }

  // The banner counts what « Voir » lists: the receipts of the last read that are still reconciled (undone or since
  // turned into a gap, they are no longer « automatic »).
  const lastAuto = (data) => {
    const stored = parseJson(settings.get('reconciliationAutoConfirmed'), null);
    if (!stored) return null;
    const keys = new Set((stored.keys || []).filter((k) => data.items.some((i) => i.key === k && i.state === 'reconciled' && i.bank.some((b) => b.auto))));
    return { count: keys.size, at: stored.at, keys: [...keys] };
  };

  const envelope = (data) => ({
    autoConfirmed: (({ count, at }) => (count == null ? null : { count, at }))(lastAuto(data) || {}),
    lastReadAt: settings.get('reconciliationLastReadAt') || null,
    lastError: lastError(),
    startDate: data.startDate,
    counts: data.counts,
    mollie: mollie ? mollie.status() : null,
  });

  const VIEWS = {
    todo: (d) => ({
      items: [...d.items.filter((i) => i.isGap), ...d.items.filter((i) => i.state === 'proposed')],
      credits: d.credits.filter((c) => c.status === 'unmatched'),
    }),
    done: (d) => ({ items: d.items.filter((i) => i.state === 'reconciled'), credits: [] }),
    waiting: (d) => ({ items: d.items.filter((i) => i.state === 'waiting' || i.state === 'partial'), credits: [] }),
    other: (d) => ({ items: [], credits: d.credits.filter((c) => c.status === 'other' || c.status === 'outside') }),
  };

  const FILTER_ITEMS = {
    gaps: (i) => i.isGap, proposed: (i) => i.state === 'proposed', unmatched: () => false, reconciled: (i) => i.state === 'reconciled',
    auto: null,
  };

  /** Rule 12 — what « Tout confirmer » would write: sûr / probable by default, « à vérifier » counted apart. */
  function bulkSummary(items) {
    const seen = new Map();
    const needShares = new Set();
    items.forEach((i) => {
      if (!i.proposal) return;
      if (i.proposal.needsShares) needShares.add(i.proposal.id);
      else if (!seen.has(i.proposal.id)) seen.set(i.proposal.id, i.proposal);
    });
    const sumOf = (list) => ({
      proposalIds: list.map((p) => p.id), count: list.length,
      totalCents: list.reduce((t, p) => t + p.allocations.reduce((s, a) => s + a.amountCents, 0), 0),
      amounts: Object.fromEntries(list.map((p) => [p.id, p.allocations.reduce((s, a) => s + a.amountCents, 0)])),
    });
    const all = [...seen.values()];
    // `withToVerify` is the set the dialog confirms once « à vérifier » is included: the client adds nothing up.
    // `leftOut` counts the proposals no « Tout confirmer » takes (their shares are typed one by one).
    return { ...sumOf(all.filter((p) => p.confidence !== 'verifier')), toVerify: sumOf(all.filter((p) => p.confidence === 'verifier')), withToVerify: sumOf(all), leftOut: needShares.size };
  }

  /**
   * Rules 18-19 — the Mollie tranches of ONE fiche as reconciliation items (the fields the ledger's lines read): its own
   * receipts and its own bank lines, no proposal. The state is the same as the whole pass gives, bar « À confirmer »,
   * which the ledger never shows (a tranche waiting for a click is still in transit or late).
   */
  function mollieItemsOfReservation(reservationId) {
    const today = core.todayIso();
    const startDate = day(settings.get('reconciliationStartDate'));
    const row = splits && day(settings.get('mollieCardOnSiteSince')) ? db.prepare(`${RESERVATION_SQL} AND r.id = ?`).get(startDate, Number(reservationId)) : null;
    const { splitFor, sourceSplit } = splitReaders(provisionalCards({ rows: row ? [row] : [], startDate, today, only: reservationId }));
    const base = expectedReceiptsOfReservation({
      db, reservationId, startDate, today, buildLedger: core.buildLedger, parseGroup: core.parseGroup, listLinks: core.listLinks,
      listInstallments: core.listInstallments, splitFor, sourceSplit,
    });
    if (!base || !base.some((r) => r.mollie)) return [];
    const linesOf = new Map();
    const linesFor = (r) => {
      const k = keyOf(r);
      if (!linesOf.has(k)) {
        linesOf.set(k, model.linesOfReceipt(r.reservationId, r.ledgerKey).map((l) => ({ ...l, settledAt: (transactions.get(l.transactionId) || {}).settledAt })));
      }
      return linesOf.get(k);
    };
    const receipts = decorateMollieReceipts(base.filter((r) => r.mollie),
      (r) => linesFor({ reservationId: r.reservationId, ledgerKey: `${r.baseKey}#immediat` }).map((l) => day(l.settledAt)).filter(Boolean).sort().pop(), acquiringFeeOf());
    return receipts.map((r) => {
      const lines = linesFor(r);
      const st = stateOfReceipt({ receipt: r, lines, hasProposal: false, today });
      return {
        key: keyOf(r), ledgerKey: r.ledgerKey, expectedCents: r.expectedCents, expectedDate: r.expectedDate, state: st.state,
        mollie: mollieMeta(r, lines, today),
        bank: lines.map((l) => bankSide(transactions.get(l.transactionId) || { id: l.transactionId, amountCents: l.amountCents, settledAt: l.settledAt }, r.mollie.molliePaymentId)),
      };
    });
  }

  const notConnected = () => ({ status: 409, body: { error: 'Qonto n\'est pas connecté.', code: 'QONTO_NOT_CONNECTED' } });

  return {
    compute,

    /** GET /?view=&filter= — a counter is a filter (rule 11); the view's proposals come with their bulk summary (rule 12). */
    list({ view = 'todo', filter } = {}) {
      // A read is answered, not refused: the page draws « Qonto n'est pas connecté » from this body, and a browser
      // logs every 4xx answer as an error in its console (shadow trial of 4.0.0). The writes below still answer 409.
      if (!connected()) return { status: 200, body: { connected: false, code: notConnected().body.code, message: notConnected().body.error } };
      freshenSplits();
      const pick = VIEWS[view] || VIEWS.todo;
      const data = compute();
      const known = FILTERS.includes(filter) ? filter : null;
      const picked = pick(data);
      const autoKeys = known === 'auto' ? new Set((lastAuto(data) || { keys: [] }).keys) : null;
      const rows = known ? {
        items: picked.items.filter(known === 'auto' ? (i) => autoKeys.has(i.key) : FILTER_ITEMS[known]),
        credits: picked.credits.filter((c) => known === 'unmatched' && c.status === 'unmatched'),
      } : picked;
      return { status: 200, body: { ...envelope(data), view: VIEWS[view] ? view : 'todo', filter: known, ...rows, bulk: bulkSummary(rows.items) } };
    },

    /** POST /read — « Actualiser ». */
    async readNow({ view = 'todo', filter } = {}) {
      if (!connected()) return notConnected();
      const now = Date.now();
      if (now - lastAttemptAt < MIN_READ_GAP_MS) return { status: 429, body: { error: 'Lecture trop rapprochée : réessayer dans une minute.', code: 'READ_TOO_SOON' } };
      lastAttemptAt = now;
      compute();
      const result = await read();
      if (result && result.ok) { freshenSplitsNow(); await syncMollie(); afterRead(); }
      return this.list({ view, filter });
    },

    /** The 8-hour job. Inert until the page has been opened once (rule 1: the start date exists). */
    async runJob() {
      // Rule 50 — without credentials the read can only fail, and the badge already says so.
      if (!connected() || !qontoConfigured() || !day(settings.get('reconciliationStartDate'))) return { skipped: true };
      lastAttemptAt = Date.now();
      const result = await read();
      if (result && result.ok) { freshenSplitsNow(); await syncMollie(); afterRead(); }
      return result;
    },

    /** POST /links — « Confirmer » and manual linking of one credit (rules 12, 18, 34). */
    confirm({ transactionId, allocations, user }) {
      if (!optionalScalar(transactionId) || !pairsRead(allocations)) return wrongShape();
      if (!connected()) return notConnected();
      const list = Array.isArray(allocations) ? allocations : [];
      return linkPairs({ pairs: list.map((a) => ({ ...a, transactionId: String(transactionId) })), user, legacy: true });
    },

    /** POST /links/batch — several credits over several receipts, one transaction (rules 5–8, 14). */
    linkBatch({ pairs, user, proposalId }) {
      if (!pairsRead(pairs) || !optionalScalar(proposalId)) return wrongShape();
      if (!connected()) return notConnected();
      return linkPairs({ pairs: Array.isArray(pairs) ? pairs : [], user, enforceCap: true, proposalId });
    },

    /** POST /allocation-preview — what the ticked credits would do, written nowhere (rules 5–7). */
    previewAllocation({ reservationId, transactionIds, receiptKeys, pairs, proposalId }) {
      if (!pairsRead(pairs) || !optionalScalar(proposalId) || !optionalScalar(reservationId) || !listRead(transactionIds) || !listRead(receiptKeys)) return wrongShape();
      if (!connected()) return notConnected();
      const data = compute();
      const index = creditIndex(data);
      let chosen = pairs;
      if (!Array.isArray(chosen)) {
        const ids = Array.isArray(transactionIds) ? [...new Set(transactionIds.map(String))] : [];
        if (ids.length === 0 || ids.length > MAX_BATCH_CREDITS) {
          return { status: 422, body: { error: `Choisir entre 1 et ${MAX_BATCH_CREDITS} virements.`, code: 'INVALID_ALLOCATION' } };
        }
        if (ids.some((id) => !index.has(id))) return { status: 404, body: { error: 'Virement introuvable.', code: 'UNKNOWN_TRANSACTION' } };
        const wanted = Array.isArray(receiptKeys) ? new Set(receiptKeys.map(String)) : null;
        const pool = data.openReceipts.filter((r) => r.openCents > 0 && !r.alreadyCovered
          && (reservationId == null ? Boolean(wanted) : r.reservationId === Number(reservationId)) && (!wanted || wanted.has(r.key)));
        chosen = allocateFifo({ credits: ids.map((id) => index.get(id)).filter((c) => c.remainingCents > 0), receipts: pool });
      }
      const errors = explainErrors(data, chosen, validatePairs({ pairs: chosen, creditsById: index, receiptsByKey: data.receiptsByKey, enforceCap: !proposalId }));
      if (errors.length === 0 && proposalId) {
        const refusal = sharesRefusal(data, proposalId, chosen.map((p) => ({ ...p, transactionId: String(p.transactionId) })));
        if (refusal) errors.push({ code: 'SHARES_DO_NOT_SUM', field: 'shares', message: refusal });
      }
      const usable = chosen.filter((p) => index.has(String(p.transactionId)) && data.receiptsByKey.has(`${p.reservationId}|${p.ledgerKey}`));
      const credits = [...new Set(usable.map((p) => String(p.transactionId)))].map((id) => index.get(id));
      const receiptsInUse = [...new Set(usable.map((p) => `${p.reservationId}|${p.ledgerKey}`))].map((k) => data.receiptsByKey.get(k));
      const summary = summarize({ credits, receipts: receiptsInUse, pairs: usable });
      return { status: 200, body: { valid: errors.length === 0, pairs: chosen, ...summary, errors } };
    },

    /** GET /reservations/:id/credits — the dialog's credits, plausible first (rules 1–4, 10). */
    ficheCredits({ reservationId, q, offset }) {
      if (!connected()) return notConnected();
      const data = compute();
      const id = Number(reservationId);
      const item = data.items.find((i) => i.reservation.id === id);
      if (!item) {
        const row = db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(id);
        return row ? { status: 422, body: { error: 'Cette réservation est hors du périmètre du rapprochement.', code: 'RESERVATION_OUT_OF_SCOPE' } }
          : { status: 404, body: { error: 'Réservation introuvable.', code: 'UNKNOWN_RESERVATION' } };
      }
      const open = data.openReceipts.filter((r) => r.reservationId === id && r.openCents > 0 && !r.alreadyCovered);
      const credits = data.available.map((t) => creditEntity(data, t, id));
      return { status: 200, body: ficheCredits({ credits, receipts: open, lastName: item.reservation.lastName || '', q, offset }) };
    },

    /** POST /confirm-all — the proposals the page showed, each in its own transaction (rules 12–13). */
    confirmAll({ proposalIds, amounts, user }) {
      if (!listRead(proposalIds) || (amounts != null && (typeof amounts !== 'object' || !Object.values(amounts).every(optionalScalar)))) return wrongShape();
      if (!connected()) return notConnected();
      const ids = [...new Set((Array.isArray(proposalIds) ? proposalIds : []).map(String))];
      const expected = amounts && typeof amounts === 'object' ? amounts : {};
      const confirmed = [];
      const skipped = [];
      let totalCents = 0;
      ids.forEach((id) => {
        const found = proposalsOf(compute()).get(id);
        const sum = found ? found.allocations.reduce((s, a) => s + a.amountCents, 0) : null;
        if (found && found.needsShares) {
          skipped.push({ proposalId: id, reason: 'refused', message: 'Les parts de ce versement groupé sont à saisir.' });
          return;
        }
        if (!found || (expected[id] != null && Number(expected[id]) !== sum)) {
          skipped.push({ proposalId: id, reason: 'changed', message: 'Cette proposition a changé : elle reste dans la liste.' });
          return;
        }
        const answer = linkPairs({ pairs: pairsOfProposal(found), user });
        if (answer.status >= 400) {
          skipped.push({ proposalId: id, reason: 'refused', message: (answer.body && answer.body.error) || 'Refusé.' });
          return;
        }
        totalCents += sum;
        confirmed.push({ proposalId: id, keys: found.allocations.map((a) => `${a.reservationId}|${a.ledgerKey}`) });
      });
      return { status: 200, body: { confirmed, skipped, totalCents } };
    },

    /** DELETE /links/:transactionId — « Défaire » (rule 38). */
    undo({ transactionId, user }) {
      journalCache = null;
      if (!connected()) return notConnected();
      const refusal = writer.undoRefusal({ transactionId: String(transactionId) });
      if (refusal) return refusal;
      let result = { restored: [], untouched: [] };
      db.transaction(() => {
        result = writer.restoreForTransaction({ transactionId: String(transactionId), user });
        // Rule 21 — what the server confirmed alone and the operator took back is never confirmed again.
        model.removeLinesOfTransaction(transactionId).filter((l) => Number(l.auto) === 1)
          .forEach((l) => model.discard({ transactionId: l.transactionId, reservationId: l.reservationId, ledgerKey: l.ledgerKey }));
      })();
      return { status: 200, body: { ok: true, ...result } };
    },

    /** Rule 19 — discarding one fiche of a group proposal discards the whole pairing of that credit. */
    discard({ transactionId, reservationId, ledgerKey }) {
      if (!connected()) return notConnected();
      // A garbage row here is inert but permanent.
      // Reservation id 0 is a sale outside a stay (rule 1): it has no reservation row, its receipt is the proof it exists.
      const id = typeof reservationId === 'string' && /^(0|[1-9]\d*)$/.test(reservationId) ? Number(reservationId) : reservationId;
      if (!isName(transactionId) || !isName(ledgerKey) || !Number.isSafeInteger(id) || id < 0) return wrongShape();
      // Rule 68 reading (audit R42-EXT-L1) — a stay or a credit that names nothing is refused, nothing stored: a pair kept
      // for a stay id not yet given hid that stay's proposal once it was created.
      const known = id === 0 ? compute().receiptsByKey.has(`0|${ledgerKey}`) : Boolean(db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(id));
      if (!known) return unknownReservation();
      if (!transactions.get(transactionId)) return unknownTransaction();
      const txIdsOf = (p) => (p.parts ? p.parts.map((x) => x.transactionId) : [p.transactionId]);
      const shown = Object.values(compute().byTransaction).map((slot) => slot.proposal)
        .find((p) => p && txIdsOf(p).includes(String(transactionId))
          && p.allocations.some((a) => String(a.reservationId) === String(reservationId) && a.ledgerKey === ledgerKey));
      const pairs = shown
        ? shown.allocations.flatMap((a) => txIdsOf(shown).map((id) => ({ transactionId: id, reservationId: a.reservationId, ledgerKey: a.ledgerKey })))
        : [{ transactionId, reservationId, ledgerKey }];
      db.transaction(() => pairs.forEach((pair) => model.discard(pair)))();
      return { status: 201, body: { ok: true } };
    },

    setOutside({ transactionId, outside, user }) {
      if (!connected()) return notConnected();
      if (outside && !transactions.get(transactionId)) return unknownTransaction();
      if (outside) model.markOutside(transactionId, user && user.id ? user.id : null);
      else model.unmarkOutside(transactionId);
      return { status: 200, body: { ok: true } };
    },

    /** GET /candidates?transactionId=&q=&offset= — open receipts a credit can be linked to, plausible first (rule 14). */
    candidates({ transactionId, q = '', offset = 0 } = {}) {
      if (!connected()) return notConnected();
      const data = compute();
      const credit = transactionId ? creditIndex(data).get(String(transactionId)) : null;
      if (transactionId && (!credit || credit.remainingCents <= 0)) {
        return { status: 404, body: { error: 'Virement introuvable ou déjà réparti.', code: 'UNKNOWN_TRANSACTION' } };
      }
      const open = data.openReceipts.filter((r) => r.openCents > 0 && !r.alreadyCovered);
      const slot = credit ? data.byTransaction[credit.transactionId] : null;
      const suggested = new Set(slot && slot.proposal ? slot.proposal.allocations.map((a) => `${a.reservationId}|${a.ledgerKey}`) : []);
      return { status: 200, body: creditReceipts({ credit, receipts: open, suggestedKeys: suggested, q, offset }) };
    },

    /** GET /bank-accounts — the settings select (no IBAN). */
    async bankAccounts() {
      if (!connected()) return notConnected();
      try {
        const accounts = await withQonto((client, accessToken) => client.listBankAccounts({ accessToken }));
        return { status: 200, body: accounts.map((a) => ({ id: a.id, name: a.name, main: a.main })) };
      } catch (err) {
        return { status: 502, body: { error: 'Lecture des comptes Qonto impossible.', code: 'QONTO_UNAVAILABLE' } };
      }
    },

    /** The fiche's `reconciliation` block (rules 25–27), from stored data only. */
    buildFicheBlock(reservation) {
      if (!connected() || !reservation || !reservation.id) return null;
      if (!day(settings.get('reconciliationStartDate'))) return null;
      const data = compute();
      const mine = data.items.filter((i) => i.reservation.id === Number(reservation.id));
      if (mine.length === 0) return null;
      return {
        lastReadAt: settings.get('reconciliationLastReadAt') || null,
        lastError: lastError(),
        allReconciled: mine.every((i) => i.state === 'reconciled'),
        lines: mine,
        unclaimedCount: data.counts.unmatched,
      };
    },

    /** Rule 31 — a penalty declared or removed: a platform balance its lines now cover is marked received. */
    afterPenalty(reservationId) {
      if (!connected()) return false;
      return completeIfCovered(compute(), Number(reservationId));
    },

    /** The home's « Échéances » rows, decorated from the stored reconciliation (rule 22) — unchanged when it is off. */
    decorateDeadlines(rows) {
      if (!connected() || !day(settings.get('reconciliationStartDate'))) return rows;
      return decorateRows(rows, compute().items);
    },

    /** The home's « À traiter » payload (rule 22). */
    attention() {
      if (!connected() || !day(settings.get('reconciliationStartDate'))) return { gaps: 0, unmatched: 0, items: [] };
      const data = compute();
      // The home's « Échéances » card already shows a late receipt (rule 22): it is not counted twice. A Mollie tranche
      // is not on that card, so a late immediate share stays here; a late reserve has its own subject (rule 13).
      const gaps = data.items.filter((i) => i.isGap && !isLateReserve(i) && (i.state !== 'late' || i.mollie));
      return {
        gaps: gaps.length, unmatched: data.counts.unmatched,
        items: gaps.slice(0, 8).map((i) => ({
          key: i.key, reservationId: i.reservation.id, saleKey: i.reservation.saleKey || null, clientName: i.reservation.clientName, label: i.label,
          stateLabel: i.stateLabel, fixText: i.fixText,
        })),
      };
    },

    /** Rule 1 — a link seen paid is split at that moment, with the settings of that moment (never moved afterwards). */
    syncSplits() {
      const today = core.todayIso();
      journalCache = null;
      return splits ? splitsSync({ startDate: day(settings.get('reconciliationStartDate')) || today, today }) : 0;
    },

    /**
     * Rule 13 — « Retenue Mollie non reçue »: one item per fiche (or per sale outside a stay), with the OLDEST date a late
     * reserve of it was expected and the whole line the home prints (`line`), so the client only draws.
     */
    reserveAttention() {
      if (!connected() || !day(settings.get('reconciliationStartDate'))) return { count: 0, items: [] };
      const byStay = new Map();
      compute().items.filter(isLateReserve).forEach((i) => {
        // A sale outside a stay has no fiche: it is its own subject, named by its client or its label.
        const subject = i.reservation.saleKey ? `sale:${i.reservation.saleKey}` : i.reservation.id;
        const found = byStay.get(subject) || {
          reservationId: i.reservation.id, saleKey: i.reservation.saleKey || null, clientName: i.reservation.clientName, saleLabel: i.reservation.saleLabel || null, amountCents: 0, expectedDate: i.expectedDate,
          expectedDateLabel: i.mollie.expectedDateLabel,
        };
        found.amountCents += i.expectedCents;
        if (i.expectedDate < found.expectedDate) { found.expectedDate = i.expectedDate; found.expectedDateLabel = i.mollie.expectedDateLabel; }
        byStay.set(subject, found);
      });
      const items = [...byStay.values()].sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)).map((item) => ({
        ...item, amount: item.amountCents / 100, amountLabel: euros(item.amountCents),
        line: `${item.clientName} · ${euros(item.amountCents)} · attendue le ${item.expectedDateLabel}`,
      }));
      return { count: items.length, items };
    },

    /**
     * Rules 18-19 — the dated tranches of a fiche's paid links, by ledger row, and its recap line. Reads ONE fiche (its
     * receipts and its own bank lines): the fiche's GET never runs the whole reconciliation pass, nor writes.
     */
    ledgerTranches(reservationId) {
      if (!connected() || !day(settings.get('reconciliationStartDate'))) return null;
      const mine = mollieItemsOfReservation(Number(reservationId));
      if (mine.length === 0) return null;
      const views = mine.map((i) => ({ baseKey: i.mollie.ledgerRow, view: trancheView(i) }));
      const rows = {};
      views.filter(({ baseKey }) => baseKey).forEach(({ baseKey, view }) => { rows[baseKey] = [...(rows[baseKey] || []), view]; });
      return { rows, schedule: scheduleView(views.map((v) => v.view)) };
    },

    /** Rule 23 — what Mollie still owes (or, with `recent`, paid in the last 30 days), as « Versements à venir » items. */
    incomingItems({ recent = false } = {}) {
      if (!connected() || !day(settings.get('reconciliationStartDate'))) return [];
      const data = compute();
      const since = addDaysIso(data.today, -RECENT_DAYS);
      return data.items.filter((i) => i.mollie).flatMap((i) => {
        const last = i.bank[i.bank.length - 1] || null;
        if (recent ? !(last && last.date >= since) : Boolean(last)) return [];
        const reserve = i.mollie.tranche === 'retenue';
        return [{
          key: `mollie:${i.key}`,
          kind: reserve ? 'mollieReserve' : 'mollieTransit',
          kindLabel: reserve ? 'Retenue Mollie' : 'Mollie en transit',
          icon: reserve ? 'hourglass' : 'card',
          natureLabel: reserve ? 'Retenue Mollie' : immediateShareLabel(i.mollie),
          natureDetail: reserve
            ? `${percentLabel(i.mollie.reservePercent)} retenus pendant ${i.mollie.holdDays} jours · ${i.label.split(' · ')[0]}`
            : `Versement immédiat de Mollie · ${i.label.split(' · ')[0]}`,
          reservationId: i.reservation.id,
          // A sale outside a stay has no fiche: the table groups it under its client, or under its label.
          sale: i.reservation.saleKey ? { key: i.reservation.saleKey, clientName: i.reservation.hasClient ? i.reservation.clientName : '', label: i.reservation.saleLabel } : null,
          amountCents: i.expectedCents,
          expectedDate: i.expectedDate,
          receivedDate: last ? last.date : null,
          // Rule 13 — past its window without a credit: late whether or not a proposal waits for the operator's click.
          late: i.mollie.late,
          refs: last ? last.refs : { qonto: null, mollieSettlement: null, molliePayment: null },
        }];
      });
    },

    /** Rules 28-31 — the Mollie facts of a month for the accounting export (one pass serves the months asked in a row). */
    journal({ from, to }) {
      if (!connected() || !day(settings.get('reconciliationStartDate'))) return { entries: [], unattached: [], clearing: null };
      const now = Date.now();
      const stamp = JSON.stringify(db.prepare(`SELECT
        (SELECT COUNT(*) || ':' || COALESCE(MAX(id), 0) FROM bank_reconciliation_lines) AS lines,
        (SELECT COUNT(*) || ':' || COALESCE(MAX(fetchedAt), '') FROM bank_transactions) AS credits,
        (SELECT COUNT(*) || ':' || COALESCE(MAX(rowid), 0) FROM mollie_payment_splits) AS splits,
        (SELECT COUNT(*) || ':' || COALESCE(MAX(fetchedAt), '') FROM mollie_settlements) AS settlements`).get());
      if (!journalCache || journalCache.stamp !== stamp || now - journalCache.at > JOURNAL_CACHE_MS) {
        journalCache = { at: now, stamp, data: compute(), settlements: mollieSettlements ? mollieSettlements.byReference() : new Map() };
      }
      return mollieJournal(journalCache.data, { from, to }, journalCache.settlements);
    },

    /** « Effacer aussi ses données » (rule 24). */
    describeData() {
      const n = transactions.count();
      const c = model.countAll();
      const out = [];
      if (n > 0) out.push({ label: 'virements lus sur le compte Qonto', count: n });
      if (c.lines > 0) out.push({ label: 'rapprochements bancaires', count: c.lines });
      return out;
    },
  };
}

module.exports = { createReconciliationController, CREDIT_WINDOW_DAYS };
