const { toCents: cents, allocateCents } = require('./pricing/money');
/**
 * VAT basket of a payment link created for a RESERVATION (specs/payment-links-vat.md rule 8).
 *
 * A devis is replayed by the pricing engine (controllers/paymentsController `resolveVatComponents`);
 * a reservation has no engine replay — its stored columns are authoritative — so its basket is built
 * from them, with the same items per type as rule 2: the deposit is one taxable line; the balance and a
 * full payment (acompte + solde) are « amount minus tourist tax » taxable plus a 0 % « Taxe de séjour »
 * line when the tax rides on the solde. Pure; null when the stored figures cannot be split exactly (the caller then
 * keeps the single 0 % line, rule 6).
 *
 * @param {{ depositAmount, balanceAmount, finalPrice, touristTaxTotal, touristTaxAddedGuestsAmount }} row
 * @param {'deposit'|'balance'|'full'} type
 * @param {{ vatRatePercent: number, taxOnArrival: boolean, titles: object }} opts
 * @returns {{ components: Array<{ title, grossCents, taxable }>, vatRatePercent } | null}
 */
function storedLinkComponents(row, type, { vatRatePercent, taxOnArrival, titles }) {
  if (!row) return null;
  if (type === 'deposit') return { components: [{ title: titles.deposit, grossCents: cents(row.depositAmount), taxable: true }], vatRatePercent };
  if (type !== 'balance' && type !== 'full') return null;
  // A full payment is the acompte plus the solde (specs/deposit-blocks-the-dates.md rule 18): the tax
  // rides on it exactly as on the solde.
  const total = type === 'full' ? cents(Number(row.depositAmount || 0) + Number(row.balanceAmount || 0)) : cents(row.balanceAmount);
  // specs/platform-added-guests-tourist-tax.md rule 27 — the added guests' tax rides the complement, not this money.
  const tax = taxOnArrival ? 0 : Math.max(0, cents(row.touristTaxTotal) - cents(row.touristTaxAddedGuestsAmount));
  if (tax > total) return null;
  const components = [{ title: titles[type], grossCents: total - tax, taxable: true }];
  if (tax > 0) components.push({ title: 'Taxe de séjour', grossCents: tax, taxable: false });
  return { components, vatRatePercent };
}

/**
 * The basket of a link on a stay the sale-line readers serve (specs/pricing-components.md §3 rule 91, owner 2026-11-15,
 * utils/saleLinesReaders.js): the taxable part of `basket` (the bucket the link collects, tax apart) shared over the lines the
 * sale detail collects in the acompte and the solde, each at its own VAT rate. The amount never moves: the shares are the bucket's
 * cents allocated by largest remainder over what each line still owes. One line to share over (the accommodation alone, the case of
 * every stay without extras in the plan) keeps the basket as it is. Pure; `basket` comes back unchanged when it cannot be shared.
 *
 * @param {{ components, vatRatePercent } | null} basket  the stored basket (`storedLinkComponents` or an installment's)
 * @param {{ lines: Array }} detail                        the stay's sale detail (`extraSale.saleDetailOf`)
 */
function saleLineComponents(basket, detail) {
  if (!basket || !detail || !Array.isArray(detail.lines)) return basket;
  const taxableIndex = basket.components.findIndex((c) => c.taxable);
  if (taxableIndex < 0) return basket;
  const taxable = basket.components[taxableIndex];
  const byKey = new Map();
  for (const line of detail.lines) {
    if (line.collectAt !== 'plan' || line.kind === 'touristTax' || line.offered) continue;
    const owed = Math.max(0, Number(line.totalCents || 0) - Math.min(Number(line.settledCents || 0), Number(line.totalCents || 0)));
    if (owed <= 0) continue;
    const rate = Number(line.vat && line.vat.rate != null ? line.vat.rate : basket.vatRatePercent) || 0;
    const key = `${line.label}|${rate}`;
    const entry = byKey.get(key) || { label: line.label, rate, weight: 0 };
    entry.weight += owed;
    byKey.set(key, entry);
  }
  const parts = [...byKey.values()];
  if (parts.length < 2) return basket;
  const shares = allocateCents(taxable.grossCents, parts.map((p) => p.weight));
  const split = parts
    .map((p, i) => ({ title: `${taxable.title} — ${p.label}`, grossCents: shares[i], taxable: p.rate > 0, vatRatePercent: p.rate }))
    .filter((c) => c.grossCents > 0);
  const components = [...basket.components];
  components.splice(taxableIndex, 1, ...split);
  return { ...basket, components };
}

module.exports = { storedLinkComponents, saleLineComponents };
