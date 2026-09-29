/**
 * Rule 21: a customer's slug is its address, `<slug>.<domain>`.
 */

const RESERVED_SLUGS = Object.freeze(['app', 'www', 'auth', 'api', 'admin', 'console', 'mail', 'status', 'demo']);

// `isTaken(slug)` answers for every customer not yet erased, archived ones included.
function slugError(slug, isTaken) {
  const s = String(slug || '');
  if (!/^[a-z0-9-]*$/.test(s)) return 'Uniquement des minuscules sans accent, des chiffres et des tirets.';
  if (s.length < 3 || s.length > 30) return 'Entre 3 et 30 caractères.';
  if (s.startsWith('-') || s.endsWith('-')) return 'Pas de tiret au début ni à la fin.';
  if (RESERVED_SLUGS.includes(s)) return 'Adresse réservée.';
  if (isTaken(s)) return 'Adresse déjà utilisée par un autre client, y compris archivé.';
  return null;
}

module.exports = { RESERVED_SLUGS, slugError };
