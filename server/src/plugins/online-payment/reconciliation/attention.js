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

module.exports = { summarize };
