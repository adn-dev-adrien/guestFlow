/**
 * DISCOUNTS — what a stay discount takes off (specs/pricing-components.md §3 rules 16, 40).
 *
 * Contract: `allocateDiscount({ discount: { percent?, amount?, customPrice?, target }, accommodation, lines })` →
 * `{ accommodation, lines, discountCents }`.
 *   - target `nights` (the default, every stored stay): today's euro formula bit for bit — `roundMoney(accommodation × (1 −
 *     percent / 100))`, or the `customPrice` when one is set (rounded to the cent); `lines` come back untouched, `discountCents` is 0.
 *   - target `extras` / `all` (rules 16, 40): works in cents over the covered lines (`coveredLines(lines)`), plus the accommodation
 *     for `all`. For a percent `p` the discount is `D = round(Σ target × p / 100)`, for a fixed `amount` `D = min(amount, Σ target)`; `D`
 *     is split in proportion to the amounts by largest remainder (ties: accommodation, then lines by `soldAt`, then id), so Σ shares =
 *     `D` and no item goes below 0. A line is `{ ref, totalCents, soldAt?, id?, offered?, source?, settledCents? }`; the answer's
 *     `lines` are `[{ ref, shareCents }]` of the covered lines, `accommodation` is the euros after its share.
 * `coveredLines(lines)` — the lines a stay discount covers (rules 16, 59): not offered, not paid, sold with the stay (`source` fiche, devis
 * or intake; a shop or SAS sale keeps its catalogue price).
 * `discountAmountOf({ subtotal, finalPrice })` is what the discounts took off a stay. `normalizeDiscountPercent` clamps a typed percentage to 0..100; `normalizeCustomPrice` reads a typed manual price
 * (`null` when empty).
 *
 * Pure: no DB, no clock, no settings.
 */
const { roundMoney, toCents, fromCents, allocateCents } = require('./money');

// Rule 16: the fixed amount of a stay discount is stored in whole cents; anything that is not a positive amount is no amount (NULL).
function discountAmountCentsOf(value) {
  if (value === undefined || value === null || value === '') return null;
  const cents = Math.round(Number(value));
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

function fixedDiscountEuros(value) {
  const cents = discountAmountCentsOf(value);
  return cents === null ? null : fromCents(cents);
}

function normalizeDiscountPercent(discountPercent) {
  const normalizedDiscountPercent = Math.max(0, Math.min(100, Number(discountPercent || 0)));
  return normalizedDiscountPercent;
}

function normalizeCustomPrice(customPrice) {
  const customFinalPrice = customPrice === '' || customPrice === null || customPrice === undefined
    ? null
    : Number(customPrice);
  return customFinalPrice;
}

const STAY_SOURCES = ['fiche', 'devis', 'intake'];

function coveredLines(lines = []) {
  return (lines || []).filter((line) => line
    && !line.offered
    && Number(line.settledCents || 0) <= 0
    && Number(line.totalCents || 0) > 0
    && STAY_SOURCES.includes(line.source || 'fiche'));
}

function allocateDiscount({ discount = {}, accommodation = 0, lines = [] } = {}) {
  const target = discount.target || 'nights';
  if (!['nights', 'extras', 'all'].includes(target)) {
    const error = new Error(`DISCOUNT_TARGET_UNKNOWN: ${target}`);
    error.code = 'DISCOUNT_TARGET_UNKNOWN';
    throw error;
  }
  if (target === 'nights') {
    const customFinalPrice = normalizeCustomPrice(discount.customPrice);
    if (discount.amount != null && !Number.isFinite(customFinalPrice)) {
      const taken = Math.min(Math.max(0, toCents(discount.amount)), Math.max(0, toCents(accommodation)));
      return { accommodation: fromCents(toCents(accommodation) - taken), lines, discountCents: taken };
    }
    const normalizedDiscountPercent = normalizeDiscountPercent(discount.percent);
    return {
      accommodation: roundMoney(Number.isFinite(customFinalPrice)
        ? customFinalPrice
        : accommodation * (1 - normalizedDiscountPercent / 100)),
      lines,
      discountCents: 0,
    };
  }
  const items = [];
  if (target === 'all') items.push({ ref: 'accommodation', cents: Math.max(0, toCents(accommodation)) });
  const covered = coveredLines(lines)
    .map((line, index) => ({ line, index }))
    .sort((a, b) => String(a.line.soldAt || '').localeCompare(String(b.line.soldAt || '')) || Number(a.line.id || 0) - Number(b.line.id || 0) || a.index - b.index);
  for (const { line } of covered) items.push({ ref: line.ref, cents: Math.round(Number(line.totalCents)) });
  const base = items.reduce((sum, item) => sum + item.cents, 0);
  const percent = normalizeDiscountPercent(discount.percent);
  const requested = discount.amount != null ? Math.min(Math.max(0, toCents(discount.amount)), base) : Math.round((base * percent) / 100);
  const shares = allocateCents(Math.min(requested, base), items.map((item) => item.cents));
  const shareOf = new Map(items.map((item, i) => [item.ref, Math.min(shares[i], item.cents)]));
  return {
    accommodation: target === 'all' ? fromCents(Math.max(0, toCents(accommodation) - shareOf.get('accommodation'))) : roundMoney(accommodation),
    lines: covered.map(({ line }) => ({ ref: line.ref, shareCents: shareOf.get(line.ref) })),
    discountCents: [...shareOf.values()].reduce((sum, cents) => sum + cents, 0),
  };
}

/**
 * `discountLines({ discount, accommodation, lines, facts, keyOf })` — the engine's priced lines after their own discount (rule 39,
 * `facts[key].discountCents`) and the stay discount's share (rules 16, 40). `lines` are the engine lines (`totalPrice` in euros,
 * `offered`), `keyOf(line)` names a line in `facts` (`{ [key]: { discountCents, source, settledCents, soldAt, lineId } }`); a line with
 * no fact is a line being sold with the stay (source `fiche`, nothing paid). A line that gains a discount keeps its catalogue
 * amount as `grossTotalPrice`, its own part as `discountCents` and the stay's part as `stayDiscountShareCents`; its `totalPrice` is
 * what is due. A line with none is returned as it came (the quote of a stay without a discount does not change a byte).
 * → `{ lines, accommodationShareCents, extrasDiscountCents }`.
 */
function discountLines({ discount = {}, accommodation = 0, lines = [], facts = {}, keyOf = () => null } = {}) {
  const own = lines.map((line) => {
    const wanted = Math.round(Number((facts[keyOf(line)] || {}).discountCents || 0));
    return Math.min(Math.max(0, wanted), Math.max(0, toCents(line.totalPrice)));
  });
  const stay = ['extras', 'all'].includes(discount.target)
    ? allocateDiscount({
      discount,
      accommodation,
      lines: lines.map((line, index) => {
        const fact = facts[keyOf(line)] || {};
        return {
          ref: String(index), totalCents: toCents(line.totalPrice) - own[index], offered: Boolean(line.offered),
          source: fact.source, settledCents: fact.settledCents, soldAt: fact.soldAt, id: fact.lineId,
        };
      }),
    })
    : { lines: [], discountCents: 0 };
  const shareOf = new Map(stay.lines.map((entry) => [entry.ref, entry.shareCents]));
  const accommodationShareCents = discount.target === 'all' ? toCents(accommodation) - toCents(stay.accommodation) : 0;
  let extrasDiscountCents = 0;
  const out = lines.map((line, index) => {
    const share = shareOf.get(String(index)) || 0;
    if (own[index] + share === 0) return line;
    extrasDiscountCents += own[index] + share;
    return {
      ...line,
      grossTotalPrice: line.totalPrice,
      totalPrice: fromCents(toCents(line.totalPrice) - own[index] - share),
      ...(own[index] ? { discountCents: own[index] } : {}),
      ...(share ? { stayDiscountShareCents: share } : {}),
    };
  });
  return { lines: out, accommodationShareCents, extrasDiscountCents };
}

// What the discounts took off a stay: the subtotal before them less the price after them, never negative.
function discountAmountOf({ subtotal, finalPrice }) {
  const discountAmount = roundMoney(Math.max(0, subtotal - finalPrice));
  return discountAmount;
}

module.exports = {
  allocateDiscount,
  coveredLines,
  discountLines,
  discountAmountOf,
  discountAmountCentsOf,
  fixedDiscountEuros,
  normalizeDiscountPercent,
  normalizeCustomPrice,
};
