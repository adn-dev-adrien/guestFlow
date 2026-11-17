/**
 * The bank tranches live plugins add to the payments ledger (specs/mollie-rolling-reserve-and-incoming-payments.md
 * rules 18-19), declared with `ctx.ledgerBankTranches`. A paid row of the ledger gains `bankTranches[]` (the dated
 * lines under it) and the ledger a `schedule` (the one-line recap of the money still to arrive). A provider that
 * throws leaves the ledger as it was and costs a log line: a plugin never fails the fiche.
 */

const registry = require('../plugins/sdk/registry');

function decorateLedger(ledger, reservationId, logger = console) {
  if (!ledger || !Array.isArray(ledger.rows) || !reservationId) return ledger;
  const byKey = new Map();
  const schedules = [];
  registry.all().forEach((record) => {
    if (!record.ledgerBankTranches || !registry.isLive(record.id)) return;
    try {
      const found = record.ledgerBankTranches({ reservationId: Number(reservationId) });
      if (!found) return;
      Object.entries(found.rows || {}).forEach(([key, tranches]) => {
        if (Array.isArray(tranches) && tranches.length > 0) byKey.set(key, [...(byKey.get(key) || []), ...tranches]);
      });
      if (found.schedule) schedules.push(found.schedule);
    } catch (err) {
      logger.error(`[plugin:${record.id}] ledger bank tranches failed: ${err.message}`);
    }
  });
  if (byKey.size === 0 && schedules.length === 0) return ledger;
  return {
    ...ledger,
    rows: ledger.rows.map((row) => (byKey.has(row.key) ? { ...row, bankTranches: byKey.get(row.key) } : row)),
    schedule: schedules[0] || null,
  };
}

module.exports = { decorateLedger };
