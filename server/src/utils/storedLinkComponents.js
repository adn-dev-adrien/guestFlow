/**
 * VAT basket of a payment link created for a RESERVATION (specs/payment-links-vat.md rule 8).
 *
 * A devis is replayed by the pricing engine (controllers/paymentsController `resolveVatComponents`);
 * a reservation has no engine replay — its stored columns are authoritative — so its basket is built
 * from them, with the same items per type as rule 2: the deposit and a full payment are one taxable
 * line, the balance is « balance minus tourist tax » taxable plus a 0 % « Taxe de séjour » line when the
 * tax rides on the solde. Pure; null when the stored figures cannot be split exactly (the caller then
 * keeps the single 0 % line, rule 6).
 *
 * @param {{ depositAmount, balanceAmount, finalPrice, touristTaxTotal }} row
 * @param {'deposit'|'balance'|'full'} type
 * @param {{ vatRatePercent: number, taxOnArrival: boolean, titles: object }} opts
 * @returns {{ components: Array<{ title, grossCents, taxable }>, vatRatePercent } | null}
 */
function storedLinkComponents(row, type, { vatRatePercent, taxOnArrival, titles }) {
  if (!row) return null;
  const cents = (v) => Math.round(Number(v || 0) * 100);
  if (type === 'deposit') return { components: [{ title: titles.deposit, grossCents: cents(row.depositAmount), taxable: true }], vatRatePercent };
  if (type === 'full') return { components: [{ title: titles.full, grossCents: cents(row.finalPrice), taxable: true }], vatRatePercent };
  if (type !== 'balance') return null;
  const balance = cents(row.balanceAmount);
  const tax = taxOnArrival ? 0 : cents(row.touristTaxTotal);
  if (tax > balance) return null;
  const components = [{ title: titles.balance, grossCents: balance - tax, taxable: true }];
  if (tax > 0) components.push({ title: 'Taxe de séjour', grossCents: tax, taxable: false });
  return { components, vatRatePercent };
}

module.exports = { storedLinkComponents };
