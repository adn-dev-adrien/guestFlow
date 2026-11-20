/**
 * VAT RECAP — the VAT per rate a document prints (specs/pricing-components.md §3 rule 15, decision D12).
 *
 * `vatByRateOf(quote)` → `[{ rate, label, base, vat, ttc }]`, ascending by rate, amounts in euros. It reads the three family
 * figures the VAT component already cut (`accommodation|options|resources` × `NetPrice` and `VatAmount`, rounded once per
 * (class, rate) group, rule 62) and adds the families that share a rate; it cuts no VAT of its own, so the rows add up
 * to `totalVatAmount` to the cent. A family without any amount at a rate of its own prints no row. A « Sans TVA » regime
 * gives an empty list: the document carries the legal mention instead.
 */
const { toCents, fromCents } = require('./pricing/money');

const FAMILIES = ['accommodation', 'options', 'resources'];

function rateLabel(rate) {
  return `TVA ${String(rate).replace('.', ',')} %`;
}

function vatByRateOf(quote) {
  if (!quote || (quote.vatRegime && quote.vatRegime.regime === 'not_subject')) return [];
  const byRate = new Map();
  for (const family of FAMILIES) {
    const rate = Number(quote[`vatPercentage${family[0].toUpperCase()}${family.slice(1)}`]);
    if (!Number.isFinite(rate)) continue;
    const row = byRate.get(rate) || { rate, baseCents: 0, vatCents: 0 };
    row.baseCents += toCents(quote[`${family}NetPrice`] || 0);
    row.vatCents += toCents(quote[`${family}VatAmount`] || 0);
    byRate.set(rate, row);
  }
  const rows = [...byRate.values()].sort((a, b) => a.rate - b.rate);
  const present = rows.filter((row) => row.baseCents + row.vatCents !== 0);
  return (present.length > 0 ? present : rows.slice(0, 1)).map((row) => ({
    rate: row.rate,
    label: rateLabel(row.rate),
    base: fromCents(row.baseCents),
    vat: fromCents(row.vatCents),
    ttc: fromCents(row.baseCents + row.vatCents),
  }));
}

// A stored stay keeps one rate and its two totals (storedSummary): the same row shape, one row.
function vatByRateOfSingleRate({ regime, rate, net, vat }) {
  if (regime && regime.regime === 'not_subject') return [];
  const baseCents = toCents(net);
  const vatCents = toCents(vat);
  return [{
    rate: Number(rate), label: rateLabel(Number(rate)), base: fromCents(baseCents), vat: fromCents(vatCents), ttc: fromCents(baseCents + vatCents),
  }];
}

module.exports = { vatByRateOf, vatByRateOfSingleRate, rateLabel };
