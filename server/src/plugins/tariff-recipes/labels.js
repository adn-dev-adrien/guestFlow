// Ready-to-render French labels for the recipe card (specs/tariff-recipes/spec.md §3.2, fixed at
// the 2026-10-27 audit). A recipe may carry an exact fractional discount (gîte: 3/7 = 42.857…%),
// which the client printed raw; the server formats it once, in French, at most one decimal.

function frPercent(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  return `${rounded.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })} %`;
}

function lengthOfStayDiscountsLabel(recipe) {
  const table = Array.isArray(recipe && recipe.lengthOfStayDiscounts) ? recipe.lengthOfStayDiscounts : [];
  if (!table.length) return null;
  const rows = [...table].sort((a, b) => Number(a.nights) - Number(b.nights));
  return rows.map((row) => `${row.nights} nuits −${frPercent(row.discountPct)}`).join(' · ');
}

module.exports = { frPercent, lengthOfStayDiscountsLabel };
