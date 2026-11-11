/**
 * money — the shared money helpers of the pricing units (specs/pricing-components.md §3 rule 38).
 *
 * Contract: `sumMoney(values)` adds amounts left to right and rounds once, `roundMoney(value)` rounds to the cent
 * (`Math.round` on the float product: half toward +∞, so `roundMoney(-0.125)` is `-0.12`, as the engine always has),
 * `toCents(euros)` / `fromCents(cents)` convert, `allocateCents(total, weights)` splits an integer number of
 * cents in proportion to weights so that the shares sum to `total` exactly.
 *
 * Not a component: it carries no business rule. Pure — no DB, no clock, no settings.
 */

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// The sum of money amounts, rounded to the cent once, added left to right like the engine's `a + b + c + d`.
function sumMoney(values) {
  return roundMoney((values || []).reduce((sum, value) => sum + value, 0));
}

const toCents = (euros) => Math.round(Number(euros || 0) * 100);

const fromCents = (cents) => Number(cents || 0) / 100;

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

module.exports = { roundMoney, sumMoney, toCents, fromCents, allocateCents };
