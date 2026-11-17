/**
 * The journal entries live plugins book for the accounting export (specs/mollie-rolling-reserve-and-incoming-payments.md
 * rules 28-31), declared with `ctx.journalEntries`. The export reads them here from every live plugin and never requires
 * the booking plugin. A provider answers `{ entries, unattached, clearing }` for the window `{ from, to }`.
 */

const registry = require('../plugins/sdk/registry');

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function list({ from, to }, logger = console) {
  const out = { entries: [], unattached: [], clearing: null };
  if (!DAY.test(String(from || '')) || !DAY.test(String(to || ''))) return out;
  registry.all().forEach((record) => {
    if (!record.journalEntries || !registry.isLive(record.id)) return;
    try {
      const found = record.journalEntries({ from, to }) || {};
      (found.entries || []).forEach((e) => out.entries.push({ ...e, pluginId: record.id }));
      (found.unattached || []).forEach((u) => out.unattached.push({ ...u, pluginId: record.id }));
      if (found.clearing) out.clearing = { ...found.clearing, pluginId: record.id };
    } catch (err) {
      logger.error(`[journalEntries] ${record.id} threw:`, err && err.message);
    }
  });
  return out;
}

module.exports = { list };
