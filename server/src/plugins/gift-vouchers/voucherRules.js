/**
 * What a voucher is, as pure rules (specs/gift-vouchers.md rules 5-11, 28, 31). No database, no clock: the caller
 * hands the dates in, a suite moves them.
 */

const DEFAULT_MIN_CENTS = 2000;
const DEFAULT_MAX_CENTS = 200000;
const DEFAULT_VALIDITY_MONTHS = 18;
const MAX_VALIDITY_MONTHS = 120;
const DEFAULT_VAT_PERCENT = 10;

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

// Rule 41 — the `paymentMethod` of an order issued « Offert » (no sale, no VAT): never one of the tenders of the core.
const OFFERED_METHOD = 'offered';

const MONEY_KINDS = Object.freeze(['issue', 'hold', 'release', 'redeem', 'refund', 'adjust', 'cancel']);
const NOTE_KINDS = Object.freeze(['extend', 'reveal', 'mail']);
const KINDS = Object.freeze([...MONEY_KINDS, ...NOTE_KINDS]);

// Rule 31 — the direction each kind moves the balance: +1 adds, -1 takes, 0 either (adjust), null carries no money.
const SIGN = Object.freeze({
  issue: 1, release: 1, refund: 1, hold: -1, redeem: -1, cancel: -1, adjust: 0, extend: null, reveal: null, mail: null,
});

const STATES = Object.freeze(['pending', 'active', 'started', 'exhausted', 'expired', 'cancelled']);

/** The Paris calendar day of an instant: the shop's day, whatever the server's zone (rules 7, 25). */
const parisDate = (instant) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);

/** `1 234,50 €` — plain spaces, so every embedded face draws it. */
function formatEuros(cents) {
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${cents < 0 ? '-' : ''}${whole},${String(abs % 100).padStart(2, '0')} €`;
}

const formatFrDate = (iso) => String(iso).split('-').reverse().join('/');

const isIsoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Rules 6, 24 — the amount, in whole cents between the bounds: `{ ok: true, cents }` or `{ ok: false, code }`. */
function checkAmountCents(value, { minAmountCents = DEFAULT_MIN_CENTS, maxAmountCents = DEFAULT_MAX_CENTS } = {}) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return { ok: false, code: 'AMOUNT_INVALID' };
  if (value < minAmountCents || value > maxAmountCents) return { ok: false, code: 'VOUCHER_AMOUNT_OUT_OF_BOUNDS' };
  return { ok: true, cents: value };
}

/**
 * Rule 43 — the VAT rate a text or a number states, in percent: from 0 to 100, at most two decimals, `,` or `.`.
 * → `{ ok: true, percent }` or `{ ok: false, message }` (the sentence the operator reads).
 */
function checkVatRate(value) {
  const raw = (typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '').trim().replace(/\s/g, '').replace(',', '.');
  if (raw === '') return { ok: false, message: 'Saisir un taux (0 si les bons ne portent pas de TVA).' };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { ok: false, message: 'Saisir un nombre, par exemple 10 ou 5,5.' };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return { ok: false, message: 'Deux décimales au plus.' };
  const percent = Number(raw);
  if (percent > 100) return { ok: false, message: 'Saisir un taux entre 0 et 100 %.' };
  return { ok: true, percent };
}

/** Rule 43 — a TTC amount cut into HT and VAT at `percent`, to the cent: HT = round(TTC / (1 + rate)), VAT = TTC − HT. */
function vatSplit(amountCents, percent) {
  const basisPoints = Math.round(Number(percent) * 100);
  const htCents = Math.round((amountCents * 10000) / (10000 + basisPoints));
  return { ratePercent: Number(percent), htCents, vatCents: amountCents - htCents };
}

/**
 * Rules 11, 43 — the VAT of a voucher as lines `[{ ratePercent, htCents, vatCents }]`: the frozen lines of a composed voucher (one per rate its contents carry),
 * else the single rate of an amount voucher cut from its TTC.
 */
function vatLinesOf(voucher) {
  const stored = parseJson(voucher.vatLines, null);
  if (Array.isArray(stored) && stored.length) return stored;
  return [vatSplit(voucher.amountCents, voucher.vatRatePercent)];
}

/** Rule 11 — the frozen contents of a voucher or an order: `{ kind: 'lodging' }` or a composed resource; an unreadable value reads as the lodging kind it started as. */
function contentsOf(row) {
  const parsed = parseJson(row && row.contents, null);
  return parsed && typeof parsed === 'object' && (parsed.kind === 'lodging' || parsed.kind === 'resource') ? parsed : { kind: 'lodging' };
}

/** `10 %`, `5,5 %` — the rate as the French read it. */
const formatPercent = (percent) => `${String(Number(percent)).replace('.', ',')} %`;

/** Rule 7 — the issue date plus `months`, a 31st landing on the last day of a shorter month. */
function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Rule 7 — frozen on the voucher at issue: later changes of the setting never move it. */
const expiryFor = (issueDate, validityMonths = DEFAULT_VALIDITY_MONTHS) => addMonths(issueDate, validityMonths);

/** Rule 11 — the balance is the sum of the money movements, nothing else. */
const balanceOf = (movements) => movements.reduce((sum, m) => sum + (MONEY_KINDS.includes(m.kind) ? Number(m.amountCents) : 0), 0);

/**
 * Rule 10 — the six states. Only `cancelled` and an order with no voucher yet (`pending`) are stored; `started`
 * (usable, balance below the issued amount), `exhausted` and `expired` are read from the ledger and the date.
 * An exhausted voucher is never reported expired.
 */
function stateOf({ voucher, balanceCents, today }) {
  if (!voucher) return 'pending';
  if (voucher.cancelledAt) return 'cancelled';
  if (balanceCents <= 0) return 'exhausted';
  if (today > voucher.expiresOn) return 'expired';
  return balanceCents < voucher.amountCents ? 'started' : 'active';
}

/** Whether a voucher in `state` can still pay for something now (rule 8). */
const isUsable = (state) => state === 'active' || state === 'started';

/**
 * Rules 28, 31 — whether a movement keeps the ledger sound: the right sign for its kind, and a balance that stays in
 * `[0, issued amount]`. → null when it does, else the refusal code.
 */
function movementRefusal({ kind, amountCents, balanceCents, issuedCents }) {
  if (!KINDS.includes(kind)) return 'MOVEMENT_KIND_INVALID';
  const sign = SIGN[kind];
  if (sign === null) return amountCents === 0 ? null : 'MOVEMENT_AMOUNT_INVALID';
  if (!Number.isSafeInteger(amountCents) || (amountCents === 0 && kind !== 'cancel')) return 'MOVEMENT_AMOUNT_INVALID';
  if (sign !== 0 && amountCents !== 0 && Math.sign(amountCents) !== sign) return 'MOVEMENT_AMOUNT_INVALID';
  const after = balanceCents + amountCents;
  if (after < 0) return 'BALANCE_BELOW_ZERO';
  if (after > issuedCents) return 'BALANCE_ABOVE_ISSUED';
  return null;
}

/** Rule 25 — a new expiry date: a real date, in the future. */
function extensionRefusal({ expiresOn, today }) {
  if (!isIsoDate(expiresOn)) return 'DATE_INVALID';
  return expiresOn > today ? null : 'DATE_NOT_IN_FUTURE';
}

module.exports = {
  DEFAULT_MIN_CENTS,
  DEFAULT_MAX_CENTS,
  DEFAULT_VALIDITY_MONTHS,
  MAX_VALIDITY_MONTHS,
  DEFAULT_VAT_PERCENT,
  MONEY_KINDS,
  KINDS,
  STATES,
  SIGN,
  isIsoDate,
  parisDate,
  formatEuros,
  formatFrDate,
  checkAmountCents,
  checkVatRate,
  vatSplit,
  formatPercent,
  OFFERED_METHOD,
  vatLinesOf,
  contentsOf,
  parseJson,
  addMonths,
  expiryFor,
  balanceOf,
  stateOf,
  isUsable,
  movementRefusal,
  extensionRefusal,
};
