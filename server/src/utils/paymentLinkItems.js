/**
 * Qonto payment-link VAT items builder (specs/payment-links-vat.md).
 *
 * Qonto's `POST /v2/payment_links` takes a basket of items, each with its own `unit_price` (**HT**),
 * `vat_rate` (string %) and quantity 1. Qonto computes each line total as
 *   round_half_up(unit_price × (1 + vat_rate/100), 2)
 * and the link `amount` = the SUM of the per-line totals (verified live in sandbox 2026-07-03).
 *
 * GuestFlow prices are TTC and the CHARGED total is inviolable. So we send HT per taxable line and
 * guarantee the exact total: floor the HT (residual after Qonto's rounding is then always ≥ 0) and fold
 * the ≤1-cent-per-line residual into a 0 %-VAT line (the tourist-tax line if present, else a small
 * "Ajustement" line). All arithmetic is in INTEGER cents — floating point breaks half-up rounding
 * (e.g. 23295 × 1.1 = 25624.499999996 in FP → would round to 256.24 instead of 256.25).
 */

// Rate as integer hundredths-of-a-percent so 10 % → 1000, 8.5 % → 850, 20 % → 2000. Keeps everything
// in integers: a line total = htCents × (10000 + R) / 10000.
function rateToBasis(vatRatePercent) {
  return Math.round(Number(vatRatePercent || 0) * 100);
}

// Qonto's per-line total (cents) for an HT amount at rate R (basis). Half-up, integer-exact.
function lineTotalCents(htCents, R) {
  if (R <= 0) return htCents;
  return Math.floor((htCents * (10000 + R) + 5000) / 10000);
}

// HT (cents) whose Qonto line total is ≤ the TTC target (floor → non-negative residual).
function htFromTtc(ttcCents, R) {
  if (R <= 0) return ttcCents;
  return Math.floor((ttcCents * 10000) / (10000 + R));
}

/**
 * Build the wire items for a payment link.
 *   components: [{ title, grossCents, taxable }]  — grossCents are TTC cents; the SUM is the exact charge.
 *   vatRatePercent: the global VAT rate applied to taxable components (non-taxable → 0 %).
 * Returns { items: [{ title, amountCents(HT, cents), vatRate(percent) }], expectedTotalCents }.
 * `expectedTotalCents` MUST equal the caller's charged amount and is asserted against Qonto's response.
 */
function buildVatItems({ components, vatRatePercent }) {
  const list = (Array.isArray(components) ? components : []).filter((c) => c && Math.round(Number(c.grossCents || 0)) > 0);
  const target = list.reduce((s, c) => s + Math.round(Number(c.grossCents)), 0);
  const R = rateToBasis(vatRatePercent);

  const items = list.map((c) => {
    const grossCents = Math.round(Number(c.grossCents));
    if (!c.taxable || R <= 0) {
      return { title: String(c.title || 'Ligne'), amountCents: grossCents, vatRate: 0, _lineTotal: grossCents, _taxable: false };
    }
    const htCents = htFromTtc(grossCents, R);
    return { title: String(c.title || 'Ligne'), amountCents: htCents, vatRate: vatRatePercent, _lineTotal: lineTotalCents(htCents, R), _taxable: true };
  });

  const predicted = items.reduce((s, it) => s + it._lineTotal, 0);
  let residual = target - predicted; // ≥ 0 by construction (floored HT)

  if (residual > 0) {
    // Fold into an existing 0 %-VAT line (keeps the basket clean); else add a small "Ajustement" line.
    const zeroLine = items.find((it) => !it._taxable);
    if (zeroLine) {
      zeroLine.amountCents += residual;
      zeroLine._lineTotal += residual;
    } else {
      items.push({ title: 'Ajustement', amountCents: residual, vatRate: 0, _lineTotal: residual, _taxable: false });
    }
    residual = 0;
  }

  return {
    items: items.map(({ title, amountCents, vatRate }) => ({ title, amountCents, vatRate })),
    expectedTotalCents: target,
  };
}

module.exports = { buildVatItems, lineTotalCents, htFromTtc, rateToBasis };
