/**
 * The plugin's settings (specs/gift-vouchers/gift-vouchers.md rules 22, 23), each with the check `PUT /api/plugins/:id/settings` runs. The bounds, the validity, the VAT rate and the ideas of the
 * lodging voucher are a campaign's now (specs/gift-vouchers/gift-voucher-campaigns.md rule 3, `campaignRules.js`), and the e-mail of a voucher is built from the voucher itself (rule 20): no template.
 * `pageUrl` is the site page holding the voucher (the link of the e-mail), falling back to the site's origin. `linkBase` is the first segment of the two permanent paths printed on the
 * cards, `/<linkBase>/offrir/<slug>` and `/<linkBase>/utiliser` (rule 9).
 */

const DEFAULT_LINK_BASE = 'bon-cadeau';
const MAX_LINK_BASE = 40;
const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function httpsUrlError(value) {
  if (value === null || value === '') return null;
  try {
    return new URL(String(value)).protocol === 'https:' ? null : 'L’adresse doit commencer par https://.';
  } catch {
    return 'Adresse invalide.';
  }
}

function linkBaseError(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_LINK_BASE || !SEGMENT.test(value)) {
    return `Début des liens permanents : minuscules, chiffres et tirets (${MAX_LINK_BASE} caractères au plus), par exemple « ${DEFAULT_LINK_BASE} ».`;
  }
  return null;
}

// week-weekend-and-print spec rule 16 — the catalogue option a cheaper slot gives away as « Boisson offerte »: `option:<id>`, or nothing (then the gap is only traced). Only an option the
// drink line can give is accepted: the one the catalogue sells outside a stay, which is what the redemption reads (`useService.giftDrink`) — never a per-person or per-night one that would be
// accepted here and silently never given.
const NOT_GIVABLE = 'Boisson offerte : cette option ne peut pas être offerte sur l’écart (elle doit être vendable hors séjour, à l’unité).';
function drinkRefError(value, catalogue = null) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^option:[1-9]\d*$/.test(value)) return 'Boisson offerte : une option du catalogue est attendue.';
  if (!catalogue) return null;
  const element = catalogue().element(value);
  return element && element.sellable ? null : NOT_GIVABLE;
}

const DECLARED = Object.freeze([
  { key: 'pageUrl', default: '', validate: httpsUrlError },
  { key: 'linkBase', default: DEFAULT_LINK_BASE, validate: linkBaseError },
  { key: 'leftoverDrinkArticleRef', default: '', validate: (value) => drinkRefError(value) },
]);

/** The declared settings with the drink judged against the live catalogue (`catalogue` is a getter: the plugin builds it on first use). */
const declared = (catalogue) => DECLARED.map((entry) => (entry.key === 'leftoverDrinkArticleRef' ? { ...entry, validate: (value) => drinkRefError(value, catalogue) } : entry));

module.exports = { DECLARED, declared, DEFAULT_LINK_BASE };
