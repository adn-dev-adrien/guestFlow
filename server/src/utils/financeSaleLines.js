/**
 * The finance pages' reading of a stay's sale lines (specs/pricing/pricing-components.md §3 rules 31, 67; owner 2026-11-15
 * « Brancher quand même », read with « éviter de toucher les anciens séjours », utils/saleLinesReaders.js).
 *
 * The Suivi financier shows what the operator EARNS, never what was sold. On a stay the sale-line readers serve:
 *   ht(r, portion)  = the HT of a TTC portion as the share of the sale lines net of VAT (`vat.htOfLines`, each line cut by `vatOf`),
 *                     the tourist tax weighing in the TTC only and the « Complément d'arrivée » left out.
 * The earnings themselves stay `totalSejour` (the buckets the money came in by, net of the ledger): read off the lines less the
 * ledger's deductions, a stay reduced after it was paid and refunded its trop-perçu would lose that refund twice — the lines
 * already bill the reduced sale, the refund takes it off again (reservation-refunds rule 36). Measured 2026-11-15 (pass C43).
 * Any other stay (booked before 4.2.0, a devis, a cancelled stay, a database without the flag) answers null, and the page keeps
 * today's figure. Memoised per instance: create one per page read.
 */
const { htOfLines } = require('./pricing/vat');
const { readsSaleLines, hasFlagColumn } = require('./saleLinesReaders');

function create(database, { detailOf = null } = {}) {
  const enabled = hasFlagColumn(database);
  const stays = new Map();
  const stayOf = (id) => {
    if (!stays.has(id)) {
      let view = null;
      const row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
      if (row && row.kind === 'reservation' && readsSaleLines(row)) {
        let detail = null;
        try { detail = (detailOf || require('./extraSale').saleDetailOf)(row.id); } catch { detail = null; }
        if (detail && Array.isArray(detail.lines)) view = { row, lines: detail.lines };
      }
      stays.set(id, view);
    }
    return stays.get(id);
  };

  function ht(r, portion) {
    if (!enabled || !r || r.id == null || (r.kind && r.kind !== 'reservation')) return null;
    const view = stayOf(r.id);
    if (!view) return null;
    return htOfLines({ portion, lines: view.lines.filter((line) => line.kind !== 'adjustment') });
  }

  return { ht };
}

module.exports = { create };
