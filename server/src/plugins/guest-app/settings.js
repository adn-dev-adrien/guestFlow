/** The plugin's settings (specs/guest-app.md §5), each with the check `PUT /api/plugins/:id/settings` runs. */

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const DEFAULT_SOLIOMAP_URL = 'https://soliomap.domainesolio.com';

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
]);

module.exports = { DECLARED };
