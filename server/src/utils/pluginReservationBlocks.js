/**
 * The blocks live plugins add to the fiche payload (specs/plugins-phase-3b-neat.md rule 12), declared
 * with `ctx.reservationBlock(key, build)`. A block that throws is `null` and a log line: a plugin never
 * fails the fiche.
 */

const registry = require('../plugins/sdk/registry');

function reservationBlocks(reservation, logger = console) {
  const out = {};
  registry.all().forEach((record) => {
    if (!record.reservationBlocks || record.reservationBlocks.length === 0 || !registry.isLive(record.id)) return;
    record.reservationBlocks.forEach(({ key, build }) => {
      try {
        out[key] = build(reservation) ?? null;
      } catch (err) {
        logger.error(`[plugin:${record.id}] reservation block "${key}" failed: ${err.message}`);
        out[key] = null;
      }
    });
  });
  return out;
}

module.exports = { reservationBlocks };
