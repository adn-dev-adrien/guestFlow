/**
 * DISCOUNTS — what a stay discount takes off (specs/pricing-components.md §3 rules 16, 40).
 *
 * Contract: `allocateDiscount({ discount: { percent?, amount?, customPrice?, target }, accommodation, lines })` →
 * `{ accommodation }`, the accommodation after the discount. Only the target `nights` is active in PR A and it is
 * today's euro formula bit for bit: `roundMoney(accommodation × (1 − percent / 100))`, or the `customPrice` when one is
 * set (rounded to the cent). The targets `extras` and `all`, and a fixed `amount`, throw `NOT_IN_PR_A` (PR B).
 * `discountAmountOf({ subtotal, finalPrice })` is what the discounts took off a stay. `normalizeDiscountPercent` clamps a typed percentage to 0..100; `normalizeCustomPrice` reads a typed manual price
 * (`null` when empty).
 *
 * Pure: no DB, no clock, no settings.
 */
const { roundMoney } = require('./money');

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

function allocateDiscount({ discount = {}, accommodation = 0 } = {}) {
  const target = discount.target || 'nights';
  if (target !== 'nights' || discount.amount != null) {
    const error = new Error(`NOT_IN_PR_A: discount target ${target}${discount.amount != null ? ' with a fixed amount' : ''}`);
    error.code = 'NOT_IN_PR_A';
    throw error;
  }
  const customFinalPrice = normalizeCustomPrice(discount.customPrice);
  const normalizedDiscountPercent = normalizeDiscountPercent(discount.percent);
  return {
    accommodation: roundMoney(Number.isFinite(customFinalPrice)
      ? customFinalPrice
      : accommodation * (1 - normalizedDiscountPercent / 100)),
  };
}

// What the discounts took off a stay: the subtotal before them less the price after them, never negative.
function discountAmountOf({ subtotal, finalPrice }) {
  const discountAmount = roundMoney(Math.max(0, subtotal - finalPrice));
  return discountAmount;
}

module.exports = {
  allocateDiscount,
  discountAmountOf,
  normalizeDiscountPercent,
  normalizeCustomPrice,
};
