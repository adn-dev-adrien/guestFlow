/**
 * The bank reconciliation, end to end (specs/qonto-bank-reconciliation.md): read the credits, expect the
 * receipts of the fiches, propose, state, and — on the operator's confirmation — mark the fiche.
 *
 * Fat backend: every figure, state, wording and allowed action of the page and of the fiche's card is
 * computed here; the client renders. Methods return `{ status, body }`, the routes only send them.
 */

const { buildProposals, classify, DEFAULT_PATTERNS, DEFAULT_BATCH_PLATFORMS } = require('./matcher');
const { stateOfReceipt, fixText, isGap, euros } = require('./receiptStates');
const { expectedReceipts } = require('./expectedReceipts');
const { ficheCredits, creditReceipts, anchorOf } = require('./ficheCredits');
const { allocateFifo, summarize, validatePairs } = require('./allocation');
const { runAutoConfirm } = require('./autoConfirm');
const { decorateRows } = require('./deadlineDecorator');
const { randomUUID } = require('crypto');

const MIN_READ_GAP_MS = 60 * 1000;
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
const parseJson = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };

/**
 * @param {object} deps
 * @param {object} deps.db
 * @param {object} deps.settings         ctx.settings (get, set)
 * @param {object} deps.transactions     bankTransactionsModel
 * @param {object} deps.model            reconciliationModel
 * @param {object} deps.writer           ficheWriter
 * @param {Function} deps.read           `() → Promise<{ok, read, error?}>` — reads Qonto into `transactions`
 * @param {() => boolean} deps.connected
 * @param {Function} deps.withQonto      `(fn) → Promise`
 * @param {object} deps.core             `{ buildLedger, parseGroup, listLinks, platformDisplay, todayIso }`
 */
function createReconciliationController({ db, settings, transactions, model, writer, read, connected, withQonto, core }) {
  let lastAttemptAt = 0;

  const startDateOf = (today) => {
    const stored = day(settings.get('reconciliationStartDate'));
    if (stored) return stored;
    settings.set('reconciliationStartDate', today);
    return today;
  };

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
    };
  };

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

    const receipts = expectedReceipts({
      db, startDate, today, buildLedger: core.buildLedger, parseGroup: core.parseGroup, listLinks: core.listLinks, listInstallments: core.listInstallments,
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

    const matchable = txRows.filter((t) => t.currency === 'EUR' && t.settledAt && !outside.has(t.id))
      .map((t) => ({ ...t, remainingCents: t.amountCents - (allocatedOf.get(t.id) || 0) }))
      .filter((t) => t.remainingCents > 0);

    const openReceipts = receipts.map((r, order) => {
      const lines = linesByReceipt.get(keyOf(r)) || [];
      const covered = lines.reduce((s, l) => s + l.amountCents, 0);
      const isLink = r.channel === 'link';
      const open = isLink ? (lines.length > 0 ? 0 : r.expectedCents) : Math.max(0, r.expectedCents - covered);
      // A platform payout the fiche does not carry yet has no expected amount: the credit is the payout (v1 rule 36).
      const unbounded = r.channel.startsWith('platform:') && !r.payoutRecorded;
      const expectedBank = isLink ? netOf(r.expectedCents) : r.expectedCents;
      // The credit of a payout the fiche does not carry yet is its payout, but never more than the stay can pay
      // out: its gross (the platform's commission is not known to the cent), plus 1 % (review 2026-10-28).
      const unboundedCap = Math.round(Math.max(0, r.grossCents) * 1.01);
      return {
        ...r, key: keyOf(r), openCents: open, order, anchor: anchorOf(r), unbounded,
        fitCents: r.grossCents, capCents: unbounded ? unboundedCap : open, checkCap: !isLink,
        needCents: unbounded ? unboundedCap : Math.max(0, expectedBank - covered), tolerance: isLink ? Math.max(1, lines.length + 1) : 0,
        alreadyCovered: !unbounded && r.expectedCents > 0 && covered >= r.expectedCents,
      };
    });
    const { byTransaction } = buildProposals({ transactions: matchable, receipts: openReceipts, discarded, settings: cfg });

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

    const bankSide = (t) => ({
      transactionId: t.id, amountCents: t.amountCents, date: day(t.settledAt), dateLabel: frDate(t.settledAt),
      counterparty: t.counterpartyName || t.label || '', reference: t.reference || t.note || '',
    });
    const receiptByKey = new Map(receipts.map((r) => [keyOf(r), r]));

    // Rule 19 — the other receipts confirmed together with a line (same credit, same group).
    const labelOf = (l) => { const o = receiptByKey.get(`${l.reservationId}|${l.ledgerKey}`); return o ? { reservationId: l.reservationId, ledgerKey: l.ledgerKey, label: o.label, clientName: o.reservation.clientName } : null; };
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
        return other ? { reservationId: a.reservationId, ledgerKey: a.ledgerKey, label: other.label, clientName: other.reservation.clientName } : null;
      }).filter(Boolean) : [];
      const showProposal = primary && lines.length === 0;
      return {
        key: k,
        reservation: { ...r.reservation, platformDisplay: core.platformDisplay(r.reservation.platform) },
        ledgerKey: r.ledgerKey, label: r.label, channel: r.channel,
        expectedCents: r.expectedCents, expectedDate: r.expectedDate, expectedDateLabel: frDate(r.expectedDate),
        paid: r.paid, paidDate: r.paidDate,
        state: st.state, stateLabel: st.stateLabel, tone: st.tone, isGap: isGap(st.state),
        gapCents: st.gapCents, receivedCents: st.receivedCents,
        fixText: fixText({ ...st, receipt: r }),
        bank: lines.map((l) => ({
          ...bankSide(txById.get(l.transactionId) || { id: l.transactionId, amountCents: l.amountCents, settledAt: l.settledAt }),
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
        else if (cls.kind === 'platform' || cls.kind === 'acquiring') status = 'unmatched';
        else status = 'other';
        return {
          ...bankSide(t), remainingCents: Math.max(0, remaining), currency: t.currency, status, kind: cls.kind,
          platform: cls.platform || null,
          note: status === 'unmatched' ? 'Versement attendu d\'une plateforme qu\'aucune fiche ne réclame : fiche manquante ou montant mal saisi.' : null,
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

  const notConnected = () => ({ status: 409, body: { error: 'Qonto n\'est pas connecté.', code: 'QONTO_NOT_CONNECTED' } });

  return {
    compute,

    /** GET /?view=&filter= — a counter is a filter (rule 11); the view's proposals come with their bulk summary (rule 12). */
    list({ view = 'todo', filter } = {}) {
      if (!connected()) return notConnected();
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
      if (result && result.ok) afterRead();
      return this.list({ view, filter });
    },

    /** The 8-hour job. Inert until the page has been opened once (rule 1: the start date exists). */
    async runJob() {
      if (!connected() || !day(settings.get('reconciliationStartDate'))) return { skipped: true };
      lastAttemptAt = Date.now();
      const result = await read();
      if (result && result.ok) afterRead();
      return result;
    },

    /** POST /links — « Confirmer » and manual linking of one credit (rules 12, 18, 34). */
    confirm({ transactionId, allocations, user }) {
      if (!connected()) return notConnected();
      const list = Array.isArray(allocations) ? allocations : [];
      return linkPairs({ pairs: list.map((a) => ({ ...a, transactionId: String(transactionId) })), user, legacy: true });
    },

    /** POST /links/batch — several credits over several receipts, one transaction (rules 5–8, 14). */
    linkBatch({ pairs, user, proposalId }) {
      if (!connected()) return notConnected();
      return linkPairs({ pairs: Array.isArray(pairs) ? pairs : [], user, enforceCap: true, proposalId });
    },

    /** POST /allocation-preview — what the ticked credits would do, written nowhere (rules 5–7). */
    previewAllocation({ reservationId, transactionIds, receiptKeys, pairs, proposalId }) {
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
      if (!connected()) return notConnected();
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
      // The home's « Échéances » card already shows a late receipt (rule 22): it is not counted twice.
      const gaps = data.items.filter((i) => i.isGap && i.state !== 'late');
      return {
        gaps: gaps.length, unmatched: data.counts.unmatched,
        items: gaps.slice(0, 8).map((i) => ({
          key: i.key, reservationId: i.reservation.id, clientName: i.reservation.clientName, label: i.label, stateLabel: i.stateLabel, fixText: i.fixText,
        })),
      };
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
