/**
 * Validation of a resource's hourly degressivity table (specs/gift-voucher-campaigns.md rule 43):
 * `[{ fromHour, percent }]`, `fromHour` integers strictly increasing from 2, `percent` integers from 0 to 100.
 * Returns the French sentence naming the faulty row, or null when the table is acceptable (empty = linear).
 */
function degressiveTiersProblem(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return 'La dégressivité doit être une liste de lignes.';
  let previous = 1;
  for (let i = 0; i < value.length; i += 1) {
    const row = value[i] || {};
    const label = `Ligne ${i + 1}`;
    if (!Number.isInteger(row.fromHour) || row.fromHour < 2) return `${label} : l’heure de départ doit être un entier d’au moins 2.`;
    if (row.fromHour <= previous && i > 0) return `${label} : l’heure de départ doit être supérieure à celle de la ligne ${i}.`;
    if (!Number.isInteger(row.percent) || row.percent < 0 || row.percent > 100) return `${label} : la remise doit être un entier entre 0 et 100.`;
    previous = row.fromHour;
  }
  return null;
}

module.exports = { degressiveTiersProblem };
