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

const MIN_READ_GAP_MS = 60 * 1000;
const CREDIT_WINDOW_DAYS = 31;
const FICHE_CREDITS_MAX = 40;
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

    const openReceipts = receipts.map((r) => {
      const lines = linesByReceipt.get(keyOf(r)) || [];
      const covered = lines.reduce((s, l) => s + l.amountCents, 0);
      const open = r.channel === 'link' ? (lines.length > 0 ? 0 : r.expectedCents) : Math.max(0, r.expectedCents - covered);
      return { ...r, openCents: open };
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
        bank: lines.map((l) => ({ ...bankSide(txById.get(l.transactionId) || { id: l.transactionId, amountCents: l.amountCents, settledAt: l.settledAt }), allocatedCents: l.amountCents })),
        allocatedCents: lines.reduce((sum, l) => sum + l.amountCents, 0),
        proposal: showProposal && proposalTx ? {
          id: primary.id, confidence: primary.confidence, confidenceLabel: CONFIDENCE_LABELS[primary.confidence], reason: primary.reason,
          source: primary.source, allocations: primary.allocations, amountCents: mine ? mine.amountCents : primary.allocations[0].amountCents,
          bank: bankSide(proposalTx), alsoCovers,
        } : null,
        alternatives: lines.length === 0 ? alts.filter((p) => !primary || p.id !== primary.id).slice(0, 4).map((p) => {
          const t = txById.get(p.transactionId);
          return { proposalId: p.id, confidence: p.confidence, confidenceLabel: CONFIDENCE_LABELS[p.confidence], allocations: p.allocations, bank: bankSide(t) };
        }) : [],
        canUndo: lines.length > 0,
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
    return { today, startDate, bankAccountId, items, credits, counts, txById, receipts, allocatedOf, linesByReceipt };
  }

  const lastError = () => parseJson(settings.get('reconciliationLastError'), null);
  const envelope = (data) => ({
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

  const notConnected = () => ({ status: 409, body: { error: 'Qonto n\'est pas connecté.', code: 'QONTO_NOT_CONNECTED' } });

  return {
    compute,

    /** GET /?view= */
    list({ view = 'todo' } = {}) {
      if (!connected()) return notConnected();
      const pick = VIEWS[view] || VIEWS.todo;
      const data = compute();
      return { status: 200, body: { ...envelope(data), view: VIEWS[view] ? view : 'todo', ...pick(data) } };
    },

    /** POST /read — « Actualiser ». */
    async readNow({ view = 'todo' } = {}) {
      if (!connected()) return notConnected();
      const now = Date.now();
      if (now - lastAttemptAt < MIN_READ_GAP_MS) return { status: 429, body: { error: 'Lecture trop rapprochée : réessayer dans une minute.', code: 'READ_TOO_SOON' } };
      lastAttemptAt = now;
      compute();
      await read();
      return this.list({ view });
    },

    /** The 8-hour job. Inert until the page has been opened once (rule 1: the start date exists). */
    async runJob() {
      if (!connected() || !day(settings.get('reconciliationStartDate'))) return { skipped: true };
      lastAttemptAt = Date.now();
      return read();
    },

    /** POST /links — « Confirmer » and manual linking (rules 12, 18, 34). */
    confirm({ transactionId, allocations, user }) {
      if (!connected()) return notConnected();
      const data = compute();
      const tx = data.txById.get(String(transactionId));
      if (!tx) return { status: 404, body: { error: 'Virement introuvable.', code: 'UNKNOWN_TRANSACTION' } };
      const list = Array.isArray(allocations) ? allocations : [];
      if (list.length === 0 || list.some((a) => !Number.isInteger(a.amountCents) || a.amountCents <= 0)) {
        return { status: 400, body: { error: 'Montant rattaché invalide.', code: 'INVALID_ALLOCATION' } };
      }
      const remaining = tx.amountCents - (data.allocatedOf.get(tx.id) || 0);
      if (list.reduce((s, a) => s + a.amountCents, 0) > remaining) {
        return { status: 422, body: { error: `Le virement n'a plus que ${euros(remaining)} à répartir.`, code: 'ALLOCATION_EXCEEDS_TRANSACTION' } };
      }
      const byKey = new Map(data.receipts.map((r) => [keyOf(r), r]));
      for (const a of list) {
        if (!byKey.has(`${a.reservationId}|${a.ledgerKey}`)) {
          const row = db.prepare('SELECT endDate FROM reservations WHERE id = ?').get(Number(a.reservationId));
          return row && day(row.endDate) < data.startDate
            ? { status: 422, body: { error: 'Cette réservation est hors du périmètre du rapprochement.', code: 'RESERVATION_OUT_OF_SCOPE' } }
            : { status: 422, body: { error: 'Échéance inconnue.', code: 'UNKNOWN_RECEIPT' } };
        }
      }
      for (const a of list) {
        const receipt = byKey.get(`${a.reservationId}|${a.ledgerKey}`);
        const covered = model.linesOfReceipt(receipt.reservationId, receipt.ledgerKey).reduce((sum, l) => sum + l.amountCents, 0);
        const payoutUnknown = receipt.channel.startsWith('platform:') && !receipt.payoutRecorded;
        if (!payoutUnknown && receipt.expectedCents > 0 && covered >= receipt.expectedCents) {
          return { status: 422, body: { error: 'Cette échéance est déjà couverte par un autre virement.', code: 'RECEIPT_ALREADY_COVERED' } };
        }
      }
      const cfg = matcherSettings();
      const netOf = (c) => c - Math.round(c * (Number(cfg.acquiringFee.percent) || 0) / 100) - (Number(cfg.acquiringFee.fixedCents) || 0);
      const marked = [];
      const notWritten = [];
      try {
        db.transaction(() => {
          list.forEach((a) => model.addLine({
            transactionId: tx.id, reservationId: Number(a.reservationId), ledgerKey: String(a.ledgerKey),
            amountCents: a.amountCents, createdBy: user && user.id ? user.id : null,
          }));
          new Set(list.map((a) => `${a.reservationId}|${a.ledgerKey}`)).forEach((k) => {
            const receipt = byKey.get(k);
            const lines = model.linesOfReceipt(receipt.reservationId, receipt.ledgerKey)
              .map((l) => ({ ...l, settledAt: (data.txById.get(l.transactionId) || {}).settledAt }));
            const isLink = receipt.channel === 'link';
            // A platform payout the fiche does not carry yet has no expected amount: the credit is the payout (rule 36).
            const payoutUnknown = receipt.channel.startsWith('platform:') && !receipt.payoutRecorded;
            const covered = lines.reduce((sum, l) => sum + l.amountCents, 0);
            const result = writer.writeIfComplete({
              receipt, lines, expectedBankCents: payoutUnknown ? covered : (isLink ? netOf(receipt.expectedCents) : receipt.expectedCents),
              tolerance: isLink ? lines.length : 0, user,
            });
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
    },

    /** DELETE /links/:transactionId — « Défaire » (rule 38). */
    undo({ transactionId, user }) {
      if (!connected()) return notConnected();
      let result = { restored: [], untouched: [] };
      db.transaction(() => {
        result = writer.restoreForTransaction({ transactionId: String(transactionId), user });
        model.removeLinesOfTransaction(transactionId);
      })();
      return { status: 200, body: { ok: true, ...result } };
    },

    discard({ transactionId, reservationId, ledgerKey }) {
      if (!connected()) return notConnected();
      model.discard({ transactionId, reservationId, ledgerKey });
      return { status: 201, body: { ok: true } };
    },

    setOutside({ transactionId, outside, user }) {
      if (!connected()) return notConnected();
      if (outside) model.markOutside(transactionId, user && user.id ? user.id : null);
      else model.unmarkOutside(transactionId);
      return { status: 200, body: { ok: true } };
    },

    /** GET /candidates — open receipts a credit can be linked to, for the manual dialog. */
    candidates({ q = '' } = {}) {
      if (!connected()) return notConnected();
      const needle = String(q).trim().toLowerCase();
      const data = compute();
      const items = data.items
        .filter((i) => i.state !== 'reconciled')
        .filter((i) => !needle || [i.reservation.clientName, i.reservation.reservationNumber, i.reservation.propertyName, i.label].join(' ').toLowerCase().includes(needle))
        .slice(0, 60)
        .map((i) => ({ key: i.key, reservation: i.reservation, ledgerKey: i.ledgerKey, label: i.label, expectedCents: i.expectedCents, expectedDateLabel: i.expectedDateLabel, stateLabel: i.stateLabel }));
      return { status: 200, body: { items } };
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
      const available = data.credits
        .filter((c) => c.remainingCents > 0 && c.status !== 'outside' && c.currency === 'EUR')
        .slice(0, FICHE_CREDITS_MAX);
      return {
        lastReadAt: settings.get('reconciliationLastReadAt') || null,
        lastError: lastError(),
        allReconciled: mine.every((i) => i.state === 'reconciled'),
        lines: mine,
        credits: available,
        unclaimedCount: data.counts.unmatched,
      };
    },

    /** The home's « À traiter » payload (rule 22). */
    attention() {
      if (!connected() || !day(settings.get('reconciliationStartDate'))) return { gaps: 0, unmatched: 0, items: [] };
      const data = compute();
      return {
        gaps: data.counts.gaps, unmatched: data.counts.unmatched,
        items: data.items.filter((i) => i.isGap).slice(0, 8).map((i) => ({
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
