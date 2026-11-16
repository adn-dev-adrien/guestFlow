/**
 * The sums live plugins expect on the bank account (specs/mollie-rolling-reserve-and-incoming-payments.md rule 23),
 * declared with `ctx.incomingPayments`. A provider that throws contributes nothing and costs a log line: the page
 * keeps the core's own kinds.
 */

const registry = require('../plugins/sdk/registry');

function list({ recent = false } = {}, logger = console) {
  const out = [];
  registry.all().forEach((record) => {
    if (!record.incomingPayments || !registry.isLive(record.id)) return;
    try {
      (record.incomingPayments({ recent }) || []).forEach((item) => out.push({ ...item, pluginId: record.id }));
    } catch (err) {
      logger.error(`[incomingPayments] ${record.id} threw:`, err && err.message);
    }
  });
  return out;
}

module.exports = { list };
