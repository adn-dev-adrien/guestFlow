/**
 * The voucher's sale in the books (specs/gift-vouchers.md rules 43-44): the plugin lists each voucher it sold as a sale made outside any
 * stay (`ctx.standaloneSales`), on the day it was collected, for its whole amount at the VAT rate frozen on it. The journal books it as
 * HT + VAT; the stay that a voucher pays later books only what the card collected (mixed-method-payments rule 64), so the VAT of the
 * voucher's part is declared once, here.
 */

const rules = require('./voucherRules');

const DAY_MS = 24 * 60 * 60 * 1000;

function createBooks({ vouchers }) {
  /** `{ from, to }` (Paris days, inclusive) → the sales in the shape `utils/standaloneSales.js` lists. */
  function salesBetween({ from, to }) {
    const since = new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS).toISOString();
    const before = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY_MS).toISOString();
    return vouchers.issuedBetween({ since, before })
      .map((v) => ({ v, date: rules.parisDate(new Date(v.issuedAt)) }))
      .filter(({ date }) => date >= from && date <= to)
      .map(({ v, date }) => ({
        key: `giftVoucher:${v.id}`,
        date,
        totalCents: v.amountCents,
        booksCents: v.amountCents,
        cardCents: v.source === 'manual' && v.paymentMethod === 'card' ? v.amountCents : 0,
        label: `Bon cadeau ${v.number}`,
        client: { firstName: '', lastName: v.senderName || '' },
        vatRate: v.vatRatePercent,
        invoiceNumber: null,
      }));
  }

  return { salesBetween };
}

module.exports = { createBooks };
