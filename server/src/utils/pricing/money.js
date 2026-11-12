/**
 * money — the shared money helpers of the pricing units (specs/pricing-components.md §3 rule 38).
 *
 * Contract: `sumMoney(values)` adds amounts left to right and rounds once, `roundMoney(value)` rounds to the cent
 * (`Math.round` on the float product: half toward +∞, so `roundMoney(-0.125)` is `-0.12`, as the engine always has),
 * `toCents(euros)` / `fromCents(cents)` convert, `frenchEuros` / `frenchPercent` print « 1 234,56 € » / « 5,00 % » with non-breaking spaces, `allocateCents(total, weights)` splits an integer number of
 * cents in proportion to weights so that the shares sum to `total` exactly.
 *
 * Named variants (rule 38, PR C): the private copies this file replaced differ from `roundMoney` / `toCents` only in how a
 * blank or a non-number is read, and each variant reproduces one of them exactly so that no figure moves. `…OrZero` reads a value
 * that is not a number as 0 (`Number(v) || 0`, so `'12,5'` is 0); `…Strict` converts with `Number(v)` and lets NaN through
 * (`undefined` and `'12,5'` stay NaN). `roundMoney` / `toCents` read `Number(v || 0)`: `''`, `null`, `undefined` are 0 and `'12,5'` is NaN.
 *
 * Not a component: it carries no business rule. Pure — no DB, no clock, no settings.
 */

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

const roundMoneyOrZero = (value) => Math.round((Number(value) || 0) * 100) / 100;

const roundMoneyStrict = (value) => Math.round(Number(value) * 100) / 100;

// The tourist-tax freeze adds the machine epsilon so that 1.005 rounds up like a person would.
const roundMoneyEpsilon = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// The public payment payload rounds through the decimal string; it takes a number, as its caller always passed one.
const roundMoneyFixed = (value) => Number(value.toFixed(2));

// `Math.sign(x) * Math.round(Math.abs(x))`: half away from zero (the synthesis' rounding), unlike `Math.round`'s half toward +∞.
const roundHalfAway = (x) => Math.sign(x) * Math.round(Math.abs(x));

// The sum of money amounts, rounded to the cent once, added left to right like the engine's `a + b + c + d`.
function sumMoney(values) {
  return roundMoney((values || []).reduce((sum, value) => sum + value, 0));
}

const toCents = (euros) => Math.round(Number(euros || 0) * 100);

const fromCents = (cents) => Number(cents || 0) / 100;

const toCentsOrZero = (value) => Math.round((Number(value) || 0) * 100);

const toCentsStrict = (value) => Math.round(Number(value) * 100);

// The cents of an amount first rounded to the cent (`round2` then `* 100`): a ledger line keeps the cent it displays.
const roundedToCents = (value) => Math.round(roundMoneyOrZero(value) * 100);

const fromCentsStrict = (cents) => Number(cents) / 100;

// The synthesis' euros: its cents are already rounded half away from zero, the division is the only step left.
const fromCentsRounded = (cents) => Math.round(cents) / 100;

// A French amount typed or printed as « 1 234,56 » (spaces dropped, comma as the decimal point), to cents / euros.
const parseFrenchCents = (amount) => Math.round(Number(String(amount).replace(/ /g, '').replace(',', '.')) * 100);

const parseFrenchEuros = (raw) => Math.round(Number(String(raw).replace(/ /g, '').replace(',', '.')) * 100) / 100;

// An integer number of cents from a number or a numeric string; anything else, a blank or a non-finite number is `null`.
function parseIntegerCents(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/**
 * Largest-remainder allocation (specs/pricing-components.md §3 rule 40): each share is floored to the cent, the cents
 * left over go one by one to the largest remainders. Ties go to the earliest item: the caller passes the items in
 * the order that must win a tie (accommodation first, then lines by `soldAt`, then id).
 *
 * A total or weights below zero (a group holding a discount) share in proportion to the signed weights: the same rule
 * on the signed amounts, all 0 when the weights cancel out.
 *
 * @param {number} totalCents integer
 * @param {number[]} weights amounts (any unit); a zero weight never gets a cent
 * @returns {number[]} integer shares, same length as `weights`, summing to `totalCents` (all 0 when no weight)
 */
function allocateCents(totalCents, weights) {
  const total = Math.round(Number(totalCents || 0));
  const signed = total < 0 || (weights || []).some((x) => (Number(x) || 0) < 0);
  const w = (weights || []).map((x) => (signed ? Number(x) || 0 : Math.max(0, Number(x) || 0)));
  const sum = w.reduce((a, b) => a + b, 0);
  if (signed ? sum === 0 : (!(total > 0) || !(sum > 0))) return w.map(() => 0);
  const exact = w.map((x) => (total * x) / sum);
  const shares = exact.map((x) => Math.floor(x));
  let left = total - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, index) => ({ index, remainder: Math.round((x - Math.floor(x)) * 1e9) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; left > 0 && i < order.length; i += 1, left -= 1) shares[order[i].index] += 1;
  return shares;
}

// French money / percentage for the server-phrased captions (« 1 234,56 € », « 5,00 % »).
const NBSP = '\u00a0';

function frenchNumber(value) {
  const n = roundMoney(Number(value || 0));
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '−' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)},${dec}`;
}

const frenchEuros = (value) => `${frenchNumber(value)}${NBSP}€`;

const frenchPercent = (value) => `${frenchNumber(value)}${NBSP}%`;

// « 1 234,56 € » as the reconciliation tab prints it: the thousands are separated by a plain space, not a non-breaking one.
const eurosWithSpaces = (cents) => {
  const n = Math.round(cents) / 100;
  const sign = n < 0 ? '−' : '';
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  return `${sign}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${dec} €`;
};

module.exports = {
  roundMoney, roundMoneyOrZero, roundMoneyStrict, roundMoneyEpsilon, roundMoneyFixed, roundHalfAway, sumMoney,
  toCents, toCentsOrZero, toCentsStrict, roundedToCents, fromCents, fromCentsStrict, fromCentsRounded, parseFrenchCents, parseFrenchEuros,
  parseIntegerCents, allocateCents, NBSP, frenchNumber, frenchEuros, frenchPercent, eurosWithSpaces,
};
