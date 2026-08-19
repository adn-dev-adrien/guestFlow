/**
 * French one-line formatters for a per-type linen block `{ singleBeds, doubleBeds, babyBeds,
 * largeTowels, mediumTowels, smallTowels, bathMats }` (the shape every laundry endpoint emits).
 * Purely presentational — pluralisation + omission of zero segments — shared by the laundry card
 * and the extra-trip dialog so both render a block the same way.
 */

// "2 doubles · 1 simple · 3 bébé" — only non-zero segments; null when there is nothing to say.
export function formatSheets(side) {
  if (!side) return null;
  const parts = [];
  const dbl = Number(side.doubleBeds || 0);
  const sgl = Number(side.singleBeds || 0);
  const bby = Number(side.babyBeds || 0);
  if (dbl > 0) parts.push(`${dbl} double${dbl > 1 ? 's' : ''}`);
  if (sgl > 0) parts.push(`${sgl} simple${sgl > 1 ? 's' : ''}`);
  if (bby > 0) parts.push(`${bby} bébé`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// "3 grandes · 1 moyenne · 3 petites · 2 tapis" — any size at 0 is omitted; null when all are 0.
// "tapis" is invariable (specs/laundry-bath-mat.md §6).
export function formatTowels(side) {
  if (!side) return null;
  const lg = Number(side.largeTowels  || 0);
  const md = Number(side.mediumTowels || 0);
  const sm = Number(side.smallTowels  || 0);
  const bm = Number(side.bathMats     || 0);
  if (lg === 0 && md === 0 && sm === 0 && bm === 0) return null;
  const parts = [];
  if (lg > 0) parts.push(`${lg} grande${lg > 1 ? 's' : ''}`);
  if (md > 0) parts.push(`${md} moyenne${md > 1 ? 's' : ''}`);
  if (sm > 0) parts.push(`${sm} petite${sm > 1 ? 's' : ''}`);
  if (bm > 0) parts.push(`${bm} tapis`);
  return parts.join(' · ');
}

// Both families on one line ("Draps : … · Serviettes : …"), or null when the block is empty.
export function formatLinenBlock(side) {
  const sheets = formatSheets(side);
  const towels = formatTowels(side);
  const parts = [];
  if (sheets) parts.push(`Draps : ${sheets}`);
  if (towels) parts.push(`Serviettes : ${towels}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
