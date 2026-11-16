/**
 * The split of a Mollie card payment in two bank tranches (specs/mollie-rolling-reserve-and-incoming-payments.md
 * rules 1-7): the immediate share and the reserve Mollie keeps for a while.
 *
 * Pure core (`computeSplit`, `afterRefund`, `expectedDates`, `linkLedgerKey`, the settings checks) and the model that
 * stores the split once, when a payment link is first seen paid (`payment_link_splits`). A stored split never moves
 * when a setting changes (rule 2): it carries the rate and the hold it used.
 */

const { day } = require('./dates');

const DEFAULT_RATE_PERCENT = 20;
const DEFAULT_HOLD_DAYS = 90;
/** Mollie's « en solde disponible » delay, measured on a 14,00 € Tap to Pay sale (rule 4). */
const IMMEDIATE_DELAY_DAYS = 4;
/** Days after the expected date a tranche may still arrive before it is late (rule 4). */
const LATE_AFTER_DAYS = Object.freeze({ immediat: 8, retenue: 10 });
/** Days before the expected date a reserve release is already plausible (rule 4). */
const RESERVE_EARLY_DAYS = 3;

const MS_DAY = 24 * 60 * 60 * 1000;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * MS_DAY).toISOString().slice(0, 10);

const RATE_MESSAGE = 'Le taux doit être compris entre 0 et 50 %';
const HOLD_MESSAGE = 'La durée est un nombre de jours entre 1 et 365';
const SINCE_MESSAGE = 'La date doit être un jour valide qui n\'est pas dans le futur';

/** Rule 3 — a number from 0 to 50 with at most 2 decimals; '' keeps the default. */
function rateMessage(value) {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return RATE_MESSAGE;
  const n = Number(text);
  return n >= 0 && n <= 50 ? null : RATE_MESSAGE;
}

/** Rule 3 — a whole number of days from 1 to 365. */
function holdMessage(value) {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return HOLD_MESSAGE;
  const n = Number(text);
  return n >= 1 && n <= 365 ? null : HOLD_MESSAGE;
}

/** Rule 3 — a real day, not in the future. */
function sinceMessage(value, today) {
  if (value == null || String(value).trim() === '') return null;
  const text = String(value).trim();
  const real = /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
  return real && text <= today ? null : SINCE_MESSAGE;
}

/**
 * Rule 2 — the reserve settings in force: `{ ratePercent, holdDays, since }`. `since` falls back on the
 * reconciliation start date; a rate of 0 disables the reserve.
 */
function readReserveSettings(settings) {
  const rate = Number(String(settings.get('mollieReservePercent') || '').replace(',', '.'));
  const hold = Number(settings.get('mollieReserveHoldDays'));
  return {
    ratePercent: Number.isFinite(rate) && String(settings.get('mollieReservePercent') || '').trim() !== '' ? rate : DEFAULT_RATE_PERCENT,
    holdDays: Number.isInteger(hold) && hold >= 1 ? hold : DEFAULT_HOLD_DAYS,
    since: day(settings.get('mollieReserveSince')) || day(settings.get('reconciliationStartDate')) || null,
  };
}

/**
 * Rule 1 — `reserve = round(gross × rate)` to the cent, the immediate share absorbs the rounding. A payment made
 * before `since` carries no reserve (rule 2); so does a rate of 0.
 */
function computeSplit({ grossCents, ratePercent, applyReserve = true }) {
  const gross = Math.max(0, Math.round(Number(grossCents) || 0));
  const hundredths = Math.round((Number(ratePercent) || 0) * 100);
  const reserveCents = applyReserve && hundredths > 0 ? Math.min(gross, Math.round((gross * hundredths) / 10000)) : 0;
  return { grossCents: gross, reserveCents, immediateCents: gross - reserveCents };
}

/** Rule 6 — a refund reduces the immediate tranche first, then the reserve. */
function afterRefund({ immediateCents, reserveCents, refundedCents = 0 }) {
  const refunded = Math.max(0, Math.round(Number(refundedCents) || 0));
  const fromImmediate = Math.min(immediateCents, refunded);
  const fromReserve = Math.min(reserveCents, refunded - fromImmediate);
  return { immediateCents: immediateCents - fromImmediate, reserveCents: reserveCents - fromReserve };
}

/**
 * Rule 4 — the expected bank dates of the two tranches. The reserve counts from the immediate tranche's real bank
 * date when it is reconciled (`immediateBankDate`), else from the date it should have arrived.
 */
function expectedDates({ paidAt, holdDays, immediateBankDate = null }) {
  const paid = day(paidAt);
  if (!paid) return { immediat: null, retenue: null };
  const immediat = addDays(paid, IMMEDIATE_DELAY_DAYS);
  return { immediat, retenue: addDays(day(immediateBankDate) || immediat, holdDays) };
}

/** The ledger row a paid link settles (the same keys the expected receipts and the core ledger use). */
function linkLedgerKey(link, installmentNumberOf = () => null) {
  if (link.basketJson) return `basket-${link.id}`;
  if (String(link.type) === 'installment') {
    const number = installmentNumberOf(link.installmentId);
    return number == null ? null : `installment-${number}`;
  }
  if (link.type === 'deposit') return 'deposit';
  if (link.type === 'balance' || link.type === 'full') return 'balance';
  if (link.type === 'complement') return 'complement';
  return null;
}

const TRANCHES = Object.freeze({ immediat: 'immediat', retenue: 'retenue' });
const trancheKey = (ledgerKey, tranche) => `${ledgerKey}#${tranche}`;

function createSplitsModel(db) {
  const hasInstallments = () => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reservation_installments'").get());

  const installmentNumbers = () => {
    if (!hasInstallments()) return new Map();
    return new Map(db.prepare('SELECT id, number FROM reservation_installments').all().map((i) => [Number(i.id), Number(i.number)]));
  };

  const insert = db.prepare(`INSERT OR IGNORE INTO payment_link_splits
    (paymentLinkId, reservationId, ledgerKey, grossCents, immediateCents, reserveCents, ratePercent, holdDays, paidAt, createdAt)
    VALUES (@paymentLinkId, @reservationId, @ledgerKey, @grossCents, @immediateCents, @reserveCents, @ratePercent, @holdDays, @paidAt, @createdAt)`);

  return {
    /**
     * Rule 1 — stores the split of every paid link that has none yet; one already stored is never touched
     * (rule 2). `since`: a payment before it has no reserve. Idempotent.
     */
    sync({ settings, now = new Date() }) {
      const { ratePercent, holdDays, since } = readReserveSettings(settings);
      const numbers = installmentNumbers();
      const missing = db.prepare(`SELECT l.* FROM payment_links l
        WHERE l.status = 'paid' AND l.paidAt IS NOT NULL AND l.amountCents > 0
          AND NOT EXISTS (SELECT 1 FROM payment_link_splits s WHERE s.paymentLinkId = CAST(l.id AS TEXT))`).all();
      let created = 0;
      db.transaction(() => {
        missing.forEach((link) => {
          const ledgerKey = linkLedgerKey(link, (id) => numbers.get(Number(id)) ?? null);
          const paidDay = day(link.paidAt);
          if (!ledgerKey || !paidDay) return;
          const split = computeSplit({ grossCents: link.amountCents, ratePercent, applyReserve: !since || paidDay >= since });
          created += insert.run({
            paymentLinkId: String(link.id), reservationId: Number(link.reservationId), ledgerKey, ...split,
            ratePercent, holdDays, paidAt: String(link.paidAt), createdAt: now.toISOString(),
          }).changes;
        });
      })();
      return created;
    },

    forLink(linkId) {
      return db.prepare('SELECT * FROM payment_link_splits WHERE paymentLinkId = ?').get(String(linkId)) || null;
    },
    all() {
      return db.prepare('SELECT * FROM payment_link_splits ORDER BY paidAt, paymentLinkId').all();
    },
    ofReservation(reservationId) {
      return db.prepare('SELECT * FROM payment_link_splits WHERE reservationId = ? ORDER BY paidAt, paymentLinkId').all(Number(reservationId));
    },
    /** Rule 16 — the Mollie payment a link turned out to be. */
    setMolliePayment(linkId, molliePaymentId) {
      db.prepare('UPDATE payment_link_splits SET molliePaymentId = ? WHERE paymentLinkId = ? AND (molliePaymentId IS NULL OR molliePaymentId <> ?)')
        .run(String(molliePaymentId), String(linkId), String(molliePaymentId));
    },
    /** Rule 6 — what Mollie says was refunded of the payment. */
    setRefunded(linkId, refundedCents) {
      db.prepare('UPDATE payment_link_splits SET refundedCents = ? WHERE paymentLinkId = ?').run(Math.max(0, Math.round(refundedCents)), String(linkId));
    },
  };
}

module.exports = {
  DEFAULT_RATE_PERCENT, DEFAULT_HOLD_DAYS, IMMEDIATE_DELAY_DAYS, LATE_AFTER_DAYS, RESERVE_EARLY_DAYS, TRANCHES,
  rateMessage, holdMessage, sinceMessage, readReserveSettings, computeSplit, afterRefund, expectedDates, linkLedgerKey, trancheKey,
  createSplitsModel, addDays,
};
