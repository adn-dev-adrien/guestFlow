/**
 * The statement of each Mollie credit, joined to it in Qonto (specs/mollie-settlement-receipts.md rules 2-12): who is a
 * candidate, the sum check, the single upload, the retries and what the card and the reconciliation line say. Reads
 * the balance transactions already stored; calls neither Mollie nor Qonto beyond the one attachment upload.
 */

const { isMollieCredit, settlementReferenceOf } = require('./mollieSettlements');
const { createMollieStatementsModel, STATES } = require('./mollieStatementsModel');
const { shapeStatement, renderStatementPdf, formatEuros } = require('./mollieStatementPdf');
const { readReserveSettings } = require('./molliePaymentSplits');
const { day } = require('./dates');
const { uuidKey } = require('../invoiceIssuer');

const MAX_PER_RUN = 20;
const MAX_ATTEMPTS = 24;
const REAUTH_MESSAGE = 'Reconnecter Qonto pour joindre les relevés.';
const NOT_FOUND = { status: 404, body: { error: 'Relevé introuvable.', code: 'STATEMENT_NOT_FOUND' } };

// Rule 9 — Qonto no longer lets the connection attach files: a refused scope or session, or a refresh that failed.
const needsReconnect = (err) => [401, 403].includes(Number(err && err.status)) || (err && err.code) === 'QONTO_NOT_CONNECTED'
  || /insufficient_scope|invalid_grant/i.test(`${JSON.stringify((err && err.body) || '')} ${(err && err.message) || ''}`);
// Rule 9 — worth trying again next hour: no answer at all, a rate limit, or Qonto's own failure.
const isTransient = (err) => { const status = Number(err && err.status); return !status || status === 429 || status >= 500; };

/**
 * @param {object} deps
 * @param {object} deps.db
 * @param {{ get(key): string }} deps.settings           ctx.settings
 * @param {() => boolean} deps.qontoConnected
 * @param {object} deps.settlements                      the settlements model
 * @param {object} deps.splits                           the splits model (`byMolliePayment`)
 * @param {(request: object) => Promise<{ attachmentId: string|null }>} deps.attachPdf  the Qonto upload
 * @param {() => string} [deps.companyName]
 * @param {() => Date} [deps.now]
 */
function createMollieStatements({ db, settings, qontoConnected, settlements, splits, attachPdf, companyName = () => '', now = () => new Date() }) {
  const model = createMollieStatementsModel(db);
  const since = () => day(settings.get('mollieStatementsSince')) || '';
  const available = () => Boolean(qontoConnected()) && String(settings.get('mollieAccessToken') || '').trim() !== '';
  const enabled = () => available() && since() !== '';

  const reservationOf = db.prepare(`SELECT r.reservationNumber, c.firstName, c.lastName FROM reservations r
    LEFT JOIN clients c ON c.id = r.clientId WHERE r.id = ?`);
  const lookup = (paymentId) => {
    const split = splits.byMolliePayment(paymentId);
    if (!split) return null;
    const reservation = split.reservationId == null ? null : reservationOf.get(Number(split.reservationId));
    return {
      reserveCents: split.reserveCents,
      guest: reservation ? [reservation.firstName, reservation.lastName].filter(Boolean).join(' ') : '',
      reservationNumber: reservation && reservation.reservationNumber ? reservation.reservationNumber : '',
    };
  };

  // Rule 1 — a credit whose settlement is stored but whose composition is not has no statement to write: it is no candidate
  // (no slot, no chip, no count) until the balance transactions are read.
  const candidates = () => model.candidates({ since: since(), settlementOf: (reference) => settlements.findByReference(reference) })
    .map((entry) => (entry.settlement ? { ...entry, composition: settlements.compositionOf(entry.settlement.id) } : entry))
    .filter((entry) => !entry.settlement || entry.composition);
  const candidateOf = (transactionId) => candidates().find((c) => String(c.tx.id) === String(transactionId)) || null;

  /** Rules 1, 6 — the shape of the statement, `null` while the composition is unknown. */
  function shapeOf({ settlement, composition = settlements.compositionOf(settlement.id) }) {
    if (!composition) return null;
    return shapeStatement({ composition, lookup, ratePercent: readReserveSettings(settings).ratePercent });
  }

  // Rule 7 — dated by the first attempt, so a retry or the on-the-fly view is the very file Qonto already holds.
  const render = ({ tx, settlement }, shape) => {
    const row = model.get(tx.id);
    const at = row && row.firstAttemptAt ? new Date(row.firstAttemptAt) : now();
    return renderStatementPdf({ shape, settlement, credit: tx, companyName: companyName(), now: at });
  };

  // The credits being handled right now, by the job or by « Réessayer »: one at a time each (rule 7).
  const inFlight = new Set();

  /** The state of one candidate, one run: sum check, build, upload, record (rules 5, 7, 9). */
  async function process(entry) {
    const { tx, settlement } = entry;
    const before = model.get(tx.id);
    if (before && before.state === STATES.attached) return before;
    const shape = shapeOf(entry);
    if (!shape) return null;
    if (shape.totals.netCents !== Number(tx.amountCents)) {
      return model.save(tx.id, settlement.id, {
        state: STATES.mismatch,
        lastError: `Le relevé totalise ${formatEuros(shape.totals.netCents)}, le virement ${formatEuros(tx.amountCents)}.`,
      }, now());
    }
    inFlight.add(String(tx.id));
    try {
      model.firstAttemptAt(tx.id, settlement.id, now());
      const bytes = await render(entry, shape);
      const sent = await attachPdf({
        transactionId: tx.id, bytes, fileName: `releve-mollie-${settlement.reference}.pdf`,
        idempotencyKey: uuidKey(`mollie-statement:${settlement.id}:${tx.id}`),
      });
      return model.save(tx.id, settlement.id, {
        state: STATES.attached, lastError: null, attachmentId: sent && sent.attachmentId ? String(sent.attachmentId) : null, attachedAt: now().toISOString(),
      }, now());
    } catch (err) {
      if (needsReconnect(err)) {
        model.markReauth(candidates().filter((c) => c.settlement), REAUTH_MESSAGE, now());
        const refused = new Error(REAUTH_MESSAGE);
        refused.reauth = true;
        throw refused;
      }
      const lastError = String((err && err.message) || err).slice(0, 300);
      if (!isTransient(err)) return model.save(tx.id, settlement.id, { state: STATES.failed, lastError }, now());
      const attempts = ((before && before.attempts) || 0) + 1;
      return model.save(tx.id, settlement.id, { state: attempts >= MAX_ATTEMPTS ? STATES.failed : STATES.pending, attempts, lastError }, now());
    } finally {
      inFlight.delete(String(tx.id));
    }
  }

  const isOpen = (entry) => {
    const row = model.get(entry.tx.id);
    return Boolean(entry.settlement) && !inFlight.has(String(entry.tx.id)) && (!row || row.state === STATES.pending || row.state === STATES.reauth);
  };

  const lineOf = (tx) => {
    if (!enabled() || !isMollieCredit(tx) || !(Number(tx.amountCents) > 0) || (day(tx.settledAt) || '') < since()) return null;
    const row = model.get(tx.id);
    const reference = settlementReferenceOf(tx);
    const settlement = !row || row.state === STATES.mismatch ? settlements.findByReference(reference) : null;
    const shape = settlement ? shapeOf({ settlement }) : null;
    if (!row) return settlement && !shape ? null : { state: STATES.pending, error: null, attachedAt: null, gapCents: null };
    const gapCents = shape ? shape.totals.netCents - Number(tx.amountCents) : null;
    return { state: row.state, error: row.lastError || null, attachedAt: row.attachedAt || null, gapCents };
  };

  return {
    available,

    /** The card's read-only status: counters over the credits the setting covers (rule 3), and whether Qonto must be reconnected. */
    status() {
      if (!available()) return { available: false, since: '', counts: { attached: 0, pending: 0, toReview: 0 }, reauth: false };
      const counts = { attached: 0, pending: 0, toReview: 0 };
      let reauth = false;
      candidates().forEach(({ tx }) => {
        const row = model.get(tx.id);
        if (row && row.state === STATES.attached) counts.attached += 1;
        else if (row && row.state !== STATES.pending) { counts.toReview += 1; if (row.state === STATES.reauth) reauth = true; } else counts.pending += 1;
      });
      return { available: true, since: since(), counts, reauth };
    },

    lineOf,

    /** Rule 8 — the pending credits, oldest first, at most 20 a run. A Qonto 403 stops the run (rule 9). */
    async runJob() {
      if (!enabled()) return { skipped: true, attached: 0 };
      let attached = 0;
      const open = candidates().filter(isOpen).slice(0, MAX_PER_RUN);
      for (const entry of open) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const row = await process(entry);
          if (row && row.state === STATES.attached) attached += 1;
        } catch (err) {
          if (err.reauth) return { reauth: true, attached };
          throw err;
        }
      }
      return { attached };
    },

    /** Rule 10 — « Réessayer »: the attempts start again and the credit is handled at once. */
    async retry(transactionId) {
      if (!enabled()) return NOT_FOUND;
      const entry = candidateOf(transactionId);
      if (!entry || !entry.settlement) return NOT_FOUND;
      const row = model.get(entry.tx.id);
      if (inFlight.has(String(entry.tx.id))) return { status: 200, body: { statement: lineOf(entry.tx) } };
      if (row && row.state !== STATES.attached) model.save(entry.tx.id, entry.settlement.id, { state: STATES.pending, attempts: 0, lastError: null }, now());
      try {
        await process(entry);
      } catch (err) {
        if (!err.reauth) throw err;
      }
      return { status: 200, body: { statement: lineOf(entry.tx) } };
    },

    /** Rule 11 — the same PDF, built on the fly. */
    async pdf(transactionId) {
      if (!enabled()) return NOT_FOUND;
      const entry = candidateOf(transactionId);
      const shape = entry && entry.settlement ? shapeOf(entry) : null;
      if (!shape) return NOT_FOUND;
      return { status: 200, bytes: await render(entry, shape), fileName: `releve-mollie-${entry.settlement.reference}.pdf` };
    },
  };
}

module.exports = { createMollieStatements, MAX_PER_RUN, MAX_ATTEMPTS };
