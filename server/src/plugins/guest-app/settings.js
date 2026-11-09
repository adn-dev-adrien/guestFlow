/** The plugin's settings (specs/guest-app.md §5), each with the check `PUT /api/plugins/:id/settings` runs. */

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const DEFAULT_SOLIOMAP_URL = 'https://map.domainesolio.com';
const FULFILMENTS = Object.freeze(['delivery', 'pickup']);
const MAX_PICKUP_PLACE = 200;

function httpsUrlError(value) {
  if (value === null || value === '') return null;
  try {
    return new URL(String(value)).protocol === 'https:' ? null : 'L’adresse doit commencer par https://.';
  } catch {
    return 'Adresse invalide.';
  }
}

const DECLARED = Object.freeze([
  { key: 'appName', default: 'Domaine Solio', validate: (v) => (String(v ?? '').length > 60 ? 'Nom trop long (60 caractères au plus).' : null) },
  { key: 'guestHost', validate: (v) => (v === null || v === '' || HOSTNAME.test(String(v)) ? null : 'Saisissez un nom de domaine, par exemple sejour.domainesolio.com.') },
  { key: 'soliomapUrl', default: DEFAULT_SOLIOMAP_URL, validate: httpsUrlError },
  { key: 'soliomapEmbed', default: '0', validate: (v) => (v === null || ['0', '1', 0, 1, true, false].includes(v) ? null : 'Valeur invalide.') },
  { key: 'maxOrderTotal', default: '500', validate: (v) => (v === null || (Number(v) > 0 && Number(v) <= 10000) ? null : 'Montant invalide (entre 1 et 10 000 €).') },
  // Rule 41bis — one setting for every lodging: delivered to the lodging, or picked up at the place typed here.
  { key: 'fulfilment', default: 'delivery', validate: (v) => (v === null || FULFILMENTS.includes(v) ? null : 'Choisissez « Livrées au logement » ou « À retirer ».') },
  { key: 'pickupPlace', validate: (v) => (v === null || String(v).length <= MAX_PICKUP_PLACE ? null : `Le lieu de retrait fait au plus ${MAX_PICKUP_PLACE} caractères.`) },
]);

/**
 * Rule 41bis — the mode the orders take now. « À retirer » needs its place: without one (saved through the generic
 * plugin settings, which judge one key at a time) the orders stay delivered rather than point to nowhere.
 */
function fulfilmentOf(get) {
  const place = String(get('pickupPlace') || '').trim();
  return get('fulfilment') === 'pickup' && place ? { mode: 'pickup', place } : { mode: 'delivery', place: null };
}

module.exports = { DECLARED, MAX_PICKUP_PLACE, fulfilmentOf };
