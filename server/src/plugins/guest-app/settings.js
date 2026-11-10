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

const OWN_HOST_REFUSAL = 'C’est l’adresse de GuestFlow : en choisir une autre, par exemple sejour.domainesolio.com.';

/** The hostname of a URL, lower-case; '' when it is none. */
function hostnameOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** A `Host` header's name, without its port, lower-case. */
const headerHost = (value) => String(value || '').trim().replace(/:\d+$/, '').toLowerCase();

/**
 * Rule 58 — GuestFlow's own addresses: the host of its public URL, and the ones the saving request came through (its
 * `Host`, its `Origin`). A guest host equal to one of them would hand the whole back office to the guest app.
 */
function ownHostsOf({ publicUrl = '', req = null } = {}) {
  const hosts = [hostnameOf(publicUrl)];
  if (req) hosts.push(headerHost(req.headers && req.headers.host), hostnameOf(req.headers && req.headers.origin));
  return new Set(hosts.filter(Boolean));
}

/** Rule 58 — the stored guest host, unless it is GuestFlow's own: then none, so the back office stays reachable. */
function effectiveGuestHost(stored, publicUrl) {
  const host = String(stored || '').trim().toLowerCase();
  return host && !ownHostsOf({ publicUrl }).has(host) ? host : null;
}

// Rule 58 — `guestHost` is written by the plugin's own route only (`PUT /api/guest-app/studio/settings`), which sees the
// request it is saved through: the generic plugin settings PUT refuses it, and its GET leaves it out.
const DECLARED = Object.freeze([
  { key: 'appName', default: 'Domaine Solio', validate: (v) => (String(v ?? '').length > 60 ? 'Nom trop long (60 caractères au plus).' : null) },
  {
    key: 'guestHost', internal: true, validate: (v) => (v === null || v === '' || HOSTNAME.test(String(v)) ? null : 'Saisir un nom de domaine, par exemple sejour.domainesolio.com.'),
  },
  { key: 'soliomapUrl', default: DEFAULT_SOLIOMAP_URL, validate: httpsUrlError },
  { key: 'soliomapEmbed', default: '0', validate: (v) => (v === null || ['0', '1', 0, 1, true, false].includes(v) ? null : 'Valeur invalide.') },
  { key: 'maxOrderTotal', default: '500', validate: (v) => (v === null || (Number(v) > 0 && Number(v) <= 10000) ? null : 'Montant invalide (entre 1 et 10 000 €).') },
  // Rule 41bis — one setting for every lodging: delivered to the lodging, or picked up at the place typed here.
  { key: 'fulfilment', default: 'delivery', validate: (v) => (v === null || FULFILMENTS.includes(v) ? null : 'Choisir « Livrées au logement » ou « À retirer ».') },
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

module.exports = {
  DECLARED, MAX_PICKUP_PLACE, OWN_HOST_REFUSAL, effectiveGuestHost, fulfilmentOf, ownHostsOf,
};
