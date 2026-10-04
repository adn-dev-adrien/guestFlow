/** Euro amounts are cents everywhere; this is the one place they become text. */

const fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

const euros = (cents) => fmt.format(cents / 100).replace(/ /g, ' ');

// What the operator types in a price field, as it is shown back to them.
const eurosText = (cents) => String(cents / 100).replace('.', ',');

// « 59 », « 59,5 », « 59.50 € » → 5950; anything else (empty included) → null.
function parseEuros(text) {
  const s = String(text ?? '').replace(/[\s\u00a0\u202f€]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

module.exports = { euros, eurosText, parseEuros };
