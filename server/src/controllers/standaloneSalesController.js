/**
 * Standalone sales controller — HTTP face of `utils/standaloneSale.js` (specs/pricing-components.md §4.3, rules 53, 74).
 *
 *   POST /api/standalone-sales/quote   { lines, customer?, saleId?, payment? }                      priced, nothing written
 *   GET  /api/standalone-sales/vat-rates                                                              { classes: [{ vatClass, externalRate | null }] }
 *   GET  /api/standalone-sales?day=    { day, sales: [{ id, ref, clientLabel, lines, totalCents, remainingCents, statusLabel, tone }] }   « Ventes du jour »
 *   POST /api/standalone-sales/:id/payment-link  { email? } → { document, sale, paymentLink, link }   (outside-visit rules 39-40)
 *   DELETE /api/standalone-sales/:id/payment-link/:linkId → { document, paymentLink };  POST .../:linkId/email → { sent, recipientEmail }   (rules 41-42, on the click only)
 *   POST /api/standalone-sales         { lines, customer?, payment?, acceptedTotalCents? }          the sale; 409 PRICE_CHANGED when the price moved
 * `lines[i]` is `{ articleRef: 'option:<id>' | 'resource:<id>', quantity, offered? }`; `customer` is `{ name?, email?, registerAsClient? }`;
 * `payment` is `{ tenders, shortfall: { kind: 'due' } | null, paidAt? }` or absent (the reste stays to collect). Thin: parse, call the service, answer.
 */
const standaloneSale = require('../utils/standaloneSale');
const standaloneSaleLinks = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const { euros } = require('../utils/paymentTenders');

const answer = (res, result) => (result.status === 200 ? res.json((({ status, ...rest }) => rest)(result)) : res.status(result.status).json(result.body));
const parisDay = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

// The counter's own words for a sale in the day's list (« Payée », « Reste 5,00 € », « Offerte », « Annulée »), the chip tone, and its lines in one sentence.
function saleRow(document) {
  const { totals } = document;
  let statusLabel = 'Payée';
  let tone = 'paid';
  if (document.document.status === 'cancelled') { statusLabel = 'Annulée'; tone = 'off'; } else if (totals.totalCents === 0) { statusLabel = 'Offerte'; tone = 'off'; } else if (totals.remainingCents > 0) { statusLabel = `Reste ${euros(totals.remainingCents)}`; tone = 'due'; }
  return {
    id: document.document.id,
    ref: document.document.ref,
    clientLabel: document.document.client.label,
    lines: document.lines.filter((line) => line.status !== 'cancelled').map((line) => `${line.label} × ${line.quantity}${line.offered ? ' (offerte)' : ''}`),
    totalCents: totals.totalCents,
    remainingCents: totals.remainingCents,
    statusLabel,
    tone,
  };
}

const withLink = (document) => ({ document, sale: saleRow(document), paymentLink: standaloneSaleLinks.linkOf(document.document.id) });

module.exports = {
  // The external VAT rate of each class the catalogue offers (owner Q-C11): what the article form shows beside « Vendable hors séjour ».
  vatRates(req, res) {
    const rates = require('../models/ports/settingsProvider').create(require('../database')).for('vat', {});
    const { ARTICLE_VAT_CLASSES } = require('../utils/pricing/vat/settingsSchema');
    return res.json({ classes: ARTICLE_VAT_CLASSES.map((vatClass) => ({ vatClass, externalRate: Number.isFinite(rates[`vat.rate.${vatClass}.external`]) ? rates[`vat.rate.${vatClass}.external`] : null })) });
  },

  // « Ventes du jour » (owner M4): the counter's sales of a Paris day, newest first.
  list(req, res) {
    const day = typeof req.query.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day) ? req.query.day : parisDay(new Date());
    const rows = require('../database').prepare('SELECT id, soldAt FROM standalone_sales WHERE originRef IS NULL ORDER BY id DESC LIMIT 300').all()
      .filter((row) => row.soldAt && parisDay(new Date(row.soldAt)) === day);
    return res.json({ day, sales: rows.map((row) => saleRow(standaloneSale.documentOf(row.id))) });
  },

  // The link block of a counter sale that is not written yet answers from its draft reste and the typed e-mail (rule 39).
  quote(req, res) {
    const body = req.body || {};
    const result = standaloneSale.quote({
      lines: body.lines, customer: body.customer, saleId: body.saleId,
    });
    if (result.status !== 200) return answer(res, result);
    const email = (body.customer && body.customer.email) || '';
    return res.json({
      document: result.document,
      customer: result.customer,
      refusals: result.refusals,
      quoted: true,
      paymentLink: body.saleId ? standaloneSaleLinks.linkOf(Number(body.saleId)) : standaloneSaleLinks.draftLinkOf({ remainingCents: result.document.totals.remainingCents, email }),
    });
  },

  sell(req, res) {
    const body = req.body || {};
    const result = standaloneSale.sell({
      lines: body.lines,
      customer: body.customer,
      payment: body.payment,
      acceptedTotalCents: body.acceptedTotalCents,
      saleId: body.saleId,
      version: body.version,
    }, { actor: req.user ? req.user.email || String(req.user.id) : null });
    if (result.status !== 200) return answer(res, result);
    return res.json(withLink(result.document));
  },

  // Rules 39-42 on a counter sale: the reste's link, minted on the click, withdrawn, e-mailed on the click only.
  async mintLink(req, res) {
    const body = req.body || {};
    if (body.email !== undefined && body.email !== null && typeof body.email !== 'string') return res.status(400).json({ error: 'Adresse e-mail invalide.', code: 'EMAIL_INVALID' });
    const result = await standaloneSaleLinks.mint(Number(req.params.id), { email: body.email || null });
    if (result.status !== 200) return res.status(result.status).json(result.body);
    return res.json({ ...withLink(result.document), link: result.link });
  },

  async withdrawLink(req, res) {
    const result = await standaloneSaleLinks.withdraw(Number(req.params.id), Number(req.params.linkId));
    if (result.status !== 200) return res.status(result.status).json(result.body);
    return res.json(withLink(result.document));
  },

  async emailLink(req, res) {
    const result = await standaloneSaleLinks.emailLink(Number(req.params.id), Number(req.params.linkId));
    if (result.status !== 200) return res.status(result.status).json(result.body);
    return res.json({ sent: result.sent, recipientEmail: result.recipientEmail });
  },
};
