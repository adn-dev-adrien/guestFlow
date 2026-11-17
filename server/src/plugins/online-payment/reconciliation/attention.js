/**
 * The home's « À traiter » subject of the bank reconciliation (specs/qonto-bank-reconciliation.md rule 22):
 * the receipts in a gap plus the credits no fiche claims. No item when both are zero.
 */
function summarize(payload) {
  const gaps = Number(payload && payload.gaps) || 0;
  const unmatched = Number(payload && payload.unmatched) || 0;
  const count = gaps + unmatched;
  if (!count) return null;
  const parts = [];
  if (gaps) parts.push(`${gaps} ${gaps > 1 ? 'écarts' : 'écart'}`);
  if (unmatched) parts.push(`${unmatched} ${unmatched > 1 ? 'virements non rattachés' : 'virement non rattaché'}`);
  return { count, title: 'Écarts de règlement', detail: parts.join(' · '), severity: 'todo' };
}

/**
 * Rule 13 of specs/mollie-rolling-reserve-and-incoming-payments.md — « Retenue Mollie non reçue »: one item per fiche
 * whose reserve is late, naming the earliest date it was expected.
 */
function summarizeReserve(payload) {
  const items = (payload && payload.items) || [];
  if (items.length === 0) return null;
  const first = items[0];
  return {
    count: items.length, title: 'Retenue Mollie non reçue',
    detail: items.length === 1 ? `${first.clientName} · attendue le ${first.expectedDateLabel}` : `${items.length} fiches · la plus ancienne attendue le ${first.expectedDateLabel}`,
    severity: 'todo',
  };
}

module.exports = { summarize, summarizeReserve };
