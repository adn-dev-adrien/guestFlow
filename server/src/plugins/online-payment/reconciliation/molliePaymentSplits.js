/**
 * The split of a Mollie card payment in two bank tranches (specs/mollie-rolling-reserve-and-incoming-payments.md
 * rules 1-7): the immediate share and the reserve Mollie keeps for a while.
 *
 * Pure core (`computeSplit`, `afterRefund`, `expectedDates`, `linkLedgerKey`, the settings checks) and the model that
 * stores the split once, when a payment is first seen paid (`mollie_payment_splits`). A split belongs to a source
 * (`sourceType` + `sourceKey`): a payment `link`, a Qonto `invoice` paid by card (keyed by its number) or a card
 * `tender` recorded on site. A stored split never moves when a setting changes (rule 2): it carries the rate and the
 * hold it used.
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
const SOURCE_TYPES = Object.freeze({ link: 'link', invoice: 'invoice', tender: 'tender' });
/** Identity of a split, as the settlement payments and the receipts name it. */
const splitIdOf = (sourceType, sourceKey) => `${sourceType}:${sourceKey}`;

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
 * Rule 2 — the reserve settings in force: `{ ratePercent, holdDays, since, cardSince }`. `since` falls back on the
 * reconciliation start date; a rate of 0 disables the reserve. `cardSince` (rule 1, « CB sur place via Mollie depuis »)
 * is the first day a card payment recorded on site goes through Mollie; null = off.
 */
function readReserveSettings(settings) {
  const rate = Number(String(settings.get('mollieReservePercent') || '').replace(',', '.'));
  const hold = Number(settings.get('mollieReserveHoldDays'));
  return {
    ratePercent: Number.isFinite(rate) && String(settings.get('mollieReservePercent') || '').trim() !== '' ? rate : DEFAULT_RATE_PERCENT,
    holdDays: Number.isInteger(hold) && hold >= 1 ? hold : DEFAULT_HOLD_DAYS,
    since: day(settings.get('mollieReserveSince')) || day(settings.get('reconciliationStartDate')) || null,
    cardSince: day(settings.get('mollieCardOnSiteSince')) || null,
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

/**
 * The ledger row a paid link settles (the same keys the expected receipts and the core ledger use). Loop t10 D10-2 (rule 32): the link of a
 * sale outside a stay (`saleRef`, no stay) is that sale's day — `sale:<sale key>:link-<id>`, the sale key being `<saleRef>:<Paris day paid>`.
 */
function linkLedgerKey(link, installmentNumberOf = () => null) {
  if (link.saleRef) return saleLinkLedgerKey(`${link.saleRef}:${day(link.paidAt)}`, link.id);
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

/** Rule 32 — the receipts of a sale's payment link: one ledger key per link, beside the sale's own card tranches (`sale:<key>`). */
function saleLinkLedgerKey(saleKey, linkId) {
  return `sale:${saleKey}:link-${linkId}`;
}

// The one definition of a link that has a split: the sync and the migration's key rewrite read it alike (rule 8).
const PAID_LINK_FILTER = "l.status = 'paid' AND l.paidAt IS NOT NULL AND l.amountCents > 0";

/** Rule 18 — the reserve as a share of the payment, to two decimals: what was kept, not the setting that asked for it. */
const reservePercentOf = (split) => (Number(split.grossCents) > 0 ? Math.round((10000 * Number(split.reserveCents)) / Number(split.grossCents)) / 100 : 0);
/** The immediate share as a share of the payment (a reserve of 0 is a payment paid whole). */
const immediatePercentOf = (split) => (Number(split.grossCents) > 0 ? Math.round((10000 * Number(split.immediateCents)) / Number(split.grossCents)) / 100 : 100);

const TRANCHES = Object.freeze({ immediat: 'immediat', retenue: 'retenue' });
const trancheKey = (ledgerKey, tranche) => `${ledgerKey}#${tranche}`;

/**
 * Rule 2 — a correction of the data that moves the payment day ACROSS « Retenue appliquée depuis » decides again whether
 * the payment carries a reserve: `true` / `false` when the day crossed, `null` when it did not (the stored decision stands).
 */
function keepsReserve(stored, newDay, since) {
  if (!since || !newDay) return null;
  const before = day(stored.paidAt) >= since;
  const after = newDay >= since;
  return before === after ? null : after;
}

function createSplitsModel(db) {
  const hasInstallments = () => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reservation_installments'").get());

  const installmentNumbers = () => {
    if (!hasInstallments()) return new Map();
    return new Map(db.prepare('SELECT id, number FROM reservation_installments').all().map((i) => [Number(i.id), Number(i.number)]));
  };

  const insert = db.prepare(`INSERT OR IGNORE INTO mollie_payment_splits
    (sourceType, sourceKey, reservationId, ledgerKey, grossCents, immediateCents, reserveCents, ratePercent, holdDays, paidAt, molliePaymentId, createdAt)
    VALUES (@sourceType, @sourceKey, @reservationId, @ledgerKey, @grossCents, @immediateCents, @reserveCents, @ratePercent, @holdDays, @paidAt, @molliePaymentId, @createdAt)`);

  const forSource = (sourceType, sourceKey) => db.prepare('SELECT * FROM mollie_payment_splits WHERE sourceType = ? AND sourceKey = ?')
    .get(String(sourceType), String(sourceKey)) || null;

  /** What the split of one payment is with the settings of this moment, as a stored row would carry it (null: nothing to split). */
  const plan = ({ sourceType, sourceKey, reservationId = null, ledgerKey = null, grossCents, paidAt, molliePaymentId = null }, { ratePercent, holdDays, since }) => {
    const paidDay = day(paidAt);
    if (!paidDay || !(Number(grossCents) > 0)) return null;
    const split = computeSplit({ grossCents, ratePercent, applyReserve: !since || paidDay >= since });
    return {
      sourceType, sourceKey: String(sourceKey), reservationId: reservationId == null ? null : Number(reservationId), ledgerKey,
      ...split, ratePercent, holdDays, paidAt: String(paidAt), molliePaymentId,
    };
  };

  /** Stores the split of one payment with the settings of this moment; one already stored is never touched (rule 2). */
  const create = (source, reserve, now) => {
    const row = plan(source, reserve);
    return row ? insert.run({ ...row, createdAt: now.toISOString() }).changes : 0;
  };

  /** A paid link that can have a split: the one definition shared by the sync, the provisional read and `hasUnsplitLinks`. */
  const linkSource = (link, numbers) => {
    const ledgerKey = linkLedgerKey(link, (id) => numbers.get(Number(id)) ?? null);
    return ledgerKey ? {
      sourceType: SOURCE_TYPES.link, sourceKey: String(link.id), reservationId: link.reservationId == null ? null : Number(link.reservationId), ledgerKey,
      grossCents: link.amountCents, paidAt: link.paidAt,
    } : null;
  };

  const unsplitLinks = () => db.prepare(`SELECT l.* FROM payment_links l
    WHERE ${PAID_LINK_FILTER}
      AND NOT EXISTS (SELECT 1 FROM mollie_payment_splits s WHERE s.sourceType = 'link' AND s.sourceKey = CAST(l.id AS TEXT))`).all();

  return {
    /**
     * Rule 1 — stores the split of every paid link, and of every card payment taken on site, that has none yet. A link's
     * split is never touched once stored (rule 2: a setting never moves it). A card payment recorded on site is an
     * estimate until Mollie's own payment is read: while no Mollie payment is attached, it follows the amount and the day
     * the fiche (or the sale) carries NOW — a correction of the data, not a change of setting — and disappears with the
     * card payment it estimated, unless a bank line already rests on it. Idempotent.
     *
     * `candidates` are the card payments recorded on site, `{ sourceType: 'tender' | 'invoice', sourceKey, reservationId,
     * ledgerKey, grossCents, paidAt }`: they are split only from the day of « CB sur place via Mollie depuis ». `scope`
     * (`{ reservationIds: Set<number>, salesFrom, salesTo }`) is what `candidates` covers: only a split inside it can be
     * dropped for want of a candidate.
     */
    sync({ settings, candidates = [], scope = null, now = new Date() }) {
      const reserve = readReserveSettings(settings);
      const numbers = installmentNumbers();
      const missing = unsplitLinks();
      let created = 0;
      db.transaction(() => {
        missing.forEach((link) => {
          const source = linkSource(link, numbers);
          if (source) created += create(source, reserve, now);
        });
        if (!reserve.cardSince) return;
        const wanted = new Set();
        candidates.forEach((candidate) => {
          const paidDay = day(candidate.paidAt);
          if (!paidDay || paidDay < reserve.cardSince) return;
          wanted.add(splitIdOf(candidate.sourceType, candidate.sourceKey));
          const stored = forSource(candidate.sourceType, candidate.sourceKey);
          if (!stored) { created += create(candidate, reserve, now); return; }
          if (stored.molliePaymentId || (Number(stored.grossCents) === Number(candidate.grossCents) && day(stored.paidAt) === paidDay)) return;
          const split = computeSplit({
            grossCents: candidate.grossCents, ratePercent: stored.ratePercent,
            applyReserve: keepsReserve(stored, paidDay, reserve.since) ?? (Number(stored.reserveCents) > 0 || computeSplit({ grossCents: stored.grossCents, ratePercent: stored.ratePercent }).reserveCents === 0),
          });
          db.prepare('UPDATE mollie_payment_splits SET grossCents = ?, immediateCents = ?, reserveCents = ?, paidAt = ? WHERE sourceType = ? AND sourceKey = ?')
            .run(split.grossCents, split.immediateCents, split.reserveCents, String(candidate.paidAt), stored.sourceType, stored.sourceKey);
        });
        if (scope) this.dropVanished({ wanted, scope, cardSince: reserve.cardSince });
      })();
      return created;
    },

    /** Rule 1 — an estimate whose card payment is gone (typed again as cash, deleted) leaves no tranche, unless a bank line rests on it. */
    dropVanished({ wanted, scope, cardSince }) {
      const hasLine = db.prepare('SELECT 1 FROM bank_reconciliation_lines WHERE reservationId = ? AND ledgerKey IN (?, ?)');
      return db.prepare(`SELECT * FROM mollie_payment_splits
        WHERE sourceType IN ('tender', 'invoice') AND molliePaymentId IS NULL AND substr(paidAt, 1, 10) >= ?`).all(cardSince)
        .filter((stored) => !wanted.has(splitIdOf(stored.sourceType, stored.sourceKey)))
        .filter((stored) => {
          const paidDay = day(stored.paidAt);
          return stored.reservationId == null
            ? Boolean(paidDay) && paidDay >= scope.salesFrom && paidDay <= scope.salesTo
            : scope.reservationIds.has(Number(stored.reservationId));
        })
        .filter((stored) => !hasLine.get(Number(stored.reservationId || 0), trancheKey(stored.ledgerKey, 'immediat'), trancheKey(stored.ledgerKey, 'retenue')))
        .map((stored) => db.prepare('DELETE FROM mollie_payment_splits WHERE sourceType = ? AND sourceKey = ?').run(stored.sourceType, stored.sourceKey).changes)
        .reduce((t, n) => t + n, 0);
    },

    /**
     * Rule 16 — a Mollie payment paired with a Qonto invoice GuestFlow holds IS the payment: its gross and its date are
     * exact. It creates the split when none exists; one made from the on-site tender (an estimate) is corrected to the
     * payment, with the rate and the hold it already carries.
     */
    fromMolliePayment(source, payment, { settings, now = new Date() }) {
      const stored = forSource(source.sourceType, source.sourceKey);
      if (!stored) {
        create({ ...source, grossCents: payment.amountCents, paidAt: payment.paidAt, molliePaymentId: payment.id }, readReserveSettings(settings), now);
      } else if (!stored.molliePaymentId && Number(payment.amountCents) > 0 && day(payment.paidAt)) {
        const reserve = readReserveSettings(settings);
        const split = computeSplit({
          grossCents: payment.amountCents, ratePercent: stored.ratePercent,
          applyReserve: keepsReserve(stored, day(payment.paidAt), reserve.since) ?? Number(stored.reserveCents) > 0,
        });
        db.prepare('UPDATE mollie_payment_splits SET grossCents = ?, immediateCents = ?, reserveCents = ?, paidAt = ?, molliePaymentId = ? WHERE sourceType = ? AND sourceKey = ?')
          .run(split.grossCents, split.immediateCents, split.reserveCents, String(payment.paidAt), String(payment.id), stored.sourceType, stored.sourceKey);
      }
      this.setMolliePayment(source.sourceType, source.sourceKey, payment.id);
      this.setRefunded(source.sourceType, source.sourceKey, payment.refundedCents || 0);
    },

    forSource,
    /** Rule 16 — the split a Mollie payment already turned out to be. */
    byMolliePayment(molliePaymentId) {
      return db.prepare('SELECT * FROM mollie_payment_splits WHERE molliePaymentId = ? ORDER BY paidAt LIMIT 1').get(String(molliePaymentId)) || null;
    },
    /**
     * Rule 4 (measured, 2026-11-16) — the reserve Mollie really held replaces the one computed from the rate: the balance
     * transaction of the payment states it. The immediate share absorbs the difference; a reserve above the gross is no reserve.
     * @param {string} splitId  `<sourceType>:<sourceKey>`
     * @returns {number} 1 when the stored split changed
     */
    correctReserve(splitId, reserveCents) {
      const text = String(splitId);
      const cut = text.indexOf(':');
      const stored = cut < 0 ? null : forSource(text.slice(0, cut), text.slice(cut + 1));
      const reserve = Math.round(Number(reserveCents));
      if (!stored || !Number.isFinite(reserve) || reserve < 0 || reserve > Number(stored.grossCents) || reserve === Number(stored.reserveCents)) return 0;
      return db.prepare('UPDATE mollie_payment_splits SET reserveCents = ?, immediateCents = ? WHERE sourceType = ? AND sourceKey = ?')
        .run(reserve, Number(stored.grossCents) - reserve, stored.sourceType, stored.sourceKey).changes;
    },
    /**
     * Is a paid link that CAN have a split still without it? One read, no write: the page that lists the reconciliation
     * decides to sync. A link with no ledger row (a type the ledger does not know, an instalment without number) never can.
     */
    hasUnsplitLinks() {
      const numbers = installmentNumbers();
      return unsplitLinks().some((link) => linkSource(link, numbers) !== null);
    },
    /**
     * Rule 1 — the split a paid payment WOULD have with the settings in force now, never stored: what a read shows while
     * the stored split (made by the sync) does not exist yet. A stored split always wins at the caller.
     */
    provisional(source, settings) {
      return plan(source, readReserveSettings(settings));
    },
    /** The provisional split of a paid link (null when it can have none). */
    provisionalOfLink(link, settings) {
      if (!link || link.status !== 'paid' || !link.paidAt || !(Number(link.amountCents) > 0)) return null;
      const source = linkSource(link, String(link.type) === 'installment' ? installmentNumbers() : new Map());
      return source ? plan(source, readReserveSettings(settings)) : null;
    },
    /** Rule 6 — the splits of a Mollie payment whose reserve is not received yet (no reconciliation line on its `#retenue` tranche): a refund may still come. */
    openWithMolliePayment(limit = 10) {
      return db.prepare(`SELECT s.* FROM mollie_payment_splits s
        WHERE s.molliePaymentId IS NOT NULL AND s.reserveCents > 0 AND NOT EXISTS (
          SELECT 1 FROM bank_reconciliation_lines l WHERE l.reservationId = COALESCE(s.reservationId, 0) AND (l.ledgerKey = s.ledgerKey || '#retenue'
            OR (s.ledgerKey = 'complement' AND l.ledgerKey = 'checkoutComplement#retenue')))
        ORDER BY s.refundCheckedAt IS NOT NULL, s.refundCheckedAt, s.paidAt LIMIT ?`).all(limit);
    },
    forLink(linkId) {
      return forSource(SOURCE_TYPES.link, linkId);
    },
    all() {
      return db.prepare('SELECT * FROM mollie_payment_splits ORDER BY paidAt, sourceType, sourceKey').all();
    },
    ofReservation(reservationId) {
      return db.prepare('SELECT * FROM mollie_payment_splits WHERE reservationId = ? ORDER BY paidAt, sourceType, sourceKey').all(Number(reservationId));
    },
    /** Rule 16 — the Mollie payment a source turned out to be. */
    setMolliePayment(sourceType, sourceKey, molliePaymentId) {
      db.prepare('UPDATE mollie_payment_splits SET molliePaymentId = ? WHERE sourceType = ? AND sourceKey = ? AND (molliePaymentId IS NULL OR molliePaymentId <> ?)')
        .run(String(molliePaymentId), String(sourceType), String(sourceKey), String(molliePaymentId));
    },
    /** Rule 6 — the refund of this payment was asked just now: the next pass asks the ones not asked for the longest time. */
    markRefundChecked(sourceType, sourceKey, now = new Date()) {
      db.prepare('UPDATE mollie_payment_splits SET refundCheckedAt = ? WHERE sourceType = ? AND sourceKey = ?').run(now.toISOString(), String(sourceType), String(sourceKey));
    },
    /** Rule 6 — what Mollie says was refunded of the payment. */
    setRefunded(sourceType, sourceKey, refundedCents) {
      db.prepare('UPDATE mollie_payment_splits SET refundedCents = ? WHERE sourceType = ? AND sourceKey = ?')
        .run(Math.max(0, Math.round(refundedCents)), String(sourceType), String(sourceKey));
    },
  };
}

module.exports = {
  PAID_LINK_FILTER, reservePercentOf, immediatePercentOf, DEFAULT_RATE_PERCENT, DEFAULT_HOLD_DAYS, IMMEDIATE_DELAY_DAYS, LATE_AFTER_DAYS, RESERVE_EARLY_DAYS, TRANCHES, SOURCE_TYPES, splitIdOf,
  rateMessage, holdMessage, sinceMessage, readReserveSettings, computeSplit, afterRefund, expectedDates, linkLedgerKey, saleLinkLedgerKey, trancheKey,
  createSplitsModel, addDays,
};
