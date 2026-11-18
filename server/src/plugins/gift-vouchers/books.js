/**
 * The voucher's sale in the books (specs/gift-vouchers.md rules 43-44): the plugin lists each voucher it sold as a sale made outside any
 * stay (`ctx.standaloneSales`), on the day it was collected, for its whole amount at the VAT rate (or rates) frozen on it. The journal books it as
 * HT + VAT; the stay that a voucher pays later books only what the card collected (mixed-method-payments rule 64), so the VAT of the
 * voucher's part is declared once, here.
 */

const rules = require('./voucherRules');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A voucher is one sale per VAT rate its contents carry (specs/gift-voucher-campaigns.md rule 11): an amount voucher has one, a composed one a line per class it was priced
 * with. A voucher given away (« Offert », rule 41) is no sale.
 */
function salesOf(v, date) {
  if (v.paymentMethod === rules.OFFERED_METHOD) return [];
  const lines = rules.vatLinesOf(v);
  return lines.map((line) => ({
    key: lines.length === 1 ? `giftVoucher:${v.id}` : `giftVoucher:${v.id}:${line.ratePercent}`,
    date,
    totalCents: lines.length === 1 ? v.amountCents : line.htCents + line.vatCents,
    booksCents: lines.length === 1 ? v.amountCents : line.htCents + line.vatCents,
    cardCents: v.source === 'manual' && v.paymentMethod === 'card' ? (lines.length === 1 ? v.amountCents : line.htCents + line.vatCents) : 0,
    label: `Bon cadeau ${v.number}`,
    client: { firstName: '', lastName: v.senderName || '' },
    vatRate: line.ratePercent,
    invoiceNumber: null,
  }));
}

function createBooks({ vouchers }) {
  /** `{ from, to }` (Paris days, inclusive) → the sales in the shape `utils/standaloneSales.js` lists. */
  function salesBetween({ from, to }) {
    const since = new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS).toISOString();
    const before = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY_MS).toISOString();
    return vouchers.issuedBetween({ since, before })
      .map((v) => ({ v, date: rules.parisDate(new Date(v.issuedAt)) }))
      .filter(({ date }) => date >= from && date <= to)
      .flatMap(({ v, date }) => salesOf(v, date));
  }

  return { salesBetween };
}

module.exports = { createBooks };
