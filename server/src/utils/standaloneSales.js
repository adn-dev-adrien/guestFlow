/**
 * Sales made outside any stay (specs/resource-booking-pricing-and-invoicing.md rules 20-21). A plugin lists them with
 * `ctx.standaloneSales`; the journal and the card-batch reconciliation read them here, from every live plugin, and
 * never require the selling plugin.
 *
 * The core lists its own documents beside the plugins' (a standalone sale of `standalone_sales`, specs/pricing-components.md rules 63, 74): one sale per
 * document and payment day, built by `accounting/standaloneDocuments.js`; it never requires a plugin and works with every plugin off.
 *
 * Sale shape: { key, date ('YYYY-MM-DD', the payment day), totalCents, booksCents (total minus caisse interne),
 *   cardCents, label, client: { firstName, lastName }, vatRate (percent | null when VAT is off),
 *   invoiceNumber | null, groups? } — `groups` (`[{ vatClass, rate, ttcCents, vatCents }]`) is a core document's VAT split, `vatRate` then null.
 */

const registry = require('../plugins/sdk/registry');
const payments = require('../models/standalonePaymentsModel');
const { salesOfDocument } = require('./accounting/standaloneDocuments');

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// A throwing provider is logged and skipped: neither the journal nor the reconciliation fails because of a plugin.
function list({ from, to }, logger = console) {
  if (!DAY.test(String(from || '')) || !DAY.test(String(to || ''))) return [];
  const out = [];
  try {
    for (const document of payments.documentsPaidBetween(from, to)) {
      const client = document.client && !document.client.isPassage
        ? { firstName: document.client.firstName || '', lastName: document.client.lastName || '' }
        : { firstName: '', lastName: document.sale.customerName || '' };
      for (const sale of salesOfDocument({ ...document, client })) {
        if (sale.date >= from && sale.date <= to) out.push({ ...sale, pluginId: null });
      }
    }
  } catch (err) {
    logger.error('[standaloneSales] core documents threw:', err && err.message);
  }
  registry.all().forEach((r) => {
    if (!r.standaloneSales || !registry.isLive(r.id)) return;
    try {
      (r.standaloneSales({ from, to }) || []).forEach((sale) => {
        if (sale && DAY.test(String(sale.date)) && sale.date >= from && sale.date <= to) out.push({ ...sale, pluginId: r.id });
      });
    } catch (err) {
      logger.error(`[standaloneSales] ${r.id} threw:`, err && err.message);
    }
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.key).localeCompare(String(b.key)));
}

module.exports = { list };
