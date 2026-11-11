/**
 * The home's « Échéances » rows, decorated by the live plugins (specs/reconciliation-assisted-matching.md
 * rule 22), declared with `ctx.paymentDeadlineDecorator(rows => rows)`. A decorator that throws leaves the
 * rows as they were and costs a log line: a plugin never fails the home.
 */

const registry = require('../plugins/sdk/registry');

function decorateDeadlineRows(rows, logger = console) {
  let current = rows;
  registry.all().forEach((record) => {
    if (!record.paymentDeadlineDecorator || !registry.isLive(record.id)) return;
    try {
      const next = record.paymentDeadlineDecorator(current);
      if (Array.isArray(next)) current = next;
    } catch (err) {
      logger.error(`[plugin:${record.id}] payment-deadline decorator failed: ${err.message}`);
    }
  });
  return current;
}

module.exports = { decorateDeadlineRows };
