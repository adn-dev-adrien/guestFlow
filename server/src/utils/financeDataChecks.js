/**
 * The « À vérifier » panel of the Suivi financier (specs/finance-data-checks.md). Pure: the catalogue of
 * checks (key, severity, French label and hint), the cap on the listed items, and the labels of a listed
 * stay or month. The model decides WHICH stays and months a check holds; this file only shapes them.
 */

const { emailAmount } = require('./emailMoney');
const { shortDate } = require('./reservationLedger');
const { guestName } = require('./paymentLinkLabel');
const { monthLabel } = require('./financeWindow');

// Rule 4 — at most this many items per check; `count` always tells the whole number.
const ITEM_LIMIT = 20;

// Rule 3 — the order of the panel: what must be corrected first, then what deserves a look.
const SEVERITIES = ['fix', 'check', 'info'];

// Rule 2 — every check of the panel, in display order. Severity and texts live here, nowhere else.
const CHECKS = [
  {
    key: 'tourist-tax-missing',
    severity: 'fix',
    label: 'Séjours terminés sans taxe de séjour alors qu’elle est à reverser',
    hint: 'La fiche porte 0 € de taxe, mais le calcul du logement en donne une.',
  },
  {
    key: 'tourist-tax-undeclared',
    severity: 'fix',
    label: 'Mois passés dont la taxe n’est pas entièrement déclarée',
    hint: 'Des séjours déclarables du mois ne sont pas cochés « Déclarée ».',
  },
  {
    key: 'platform-payment-missing',
    severity: 'check',
    label: 'Séjours plateforme terminés sans « Paiement plateforme »',
    hint: 'Le montant payé par le client n’est pas saisi : le total vient du tarif.',
  },
  {
    key: 'guest-name-missing',
    severity: 'check',
    label: 'Séjours terminés sans nom de voyageur',
    hint: 'Le client est resté celui créé par l’import du calendrier.',
  },
];

const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** « 202609011 · Marie Martin · Granja · 26/09 → 28/09 » — the guest left out when the client is a placeholder. */
function stayLabel(stay, { year = null, withGuest = true } = {}) {
  const span = `${shortDate(stay.startDate, year)} → ${shortDate(stay.endDate, year)}`;
  return [
    stay.reservationNumber || `#${stay.id}`,
    withGuest ? guestName(stay) : '',
    stay.propertyName || '',
    span,
  ].filter(Boolean).join(' · ');
}

/** « Septembre 2026 » */
const monthItemLabel = (month) => capitalize(monthLabel(month));

/** « Reste 18,15 € à déclarer · 2 séjours », then « · dont 7,20 € pas encore déclarables » when some is not (rule 20). */
const undeclaredDetail = (amount, stays, notDeclarable = 0) => [
  `Reste ${emailAmount(amount)} à déclarer`,
  plural(stays, 'séjour', 'séjours'),
  ...(notDeclarable > 0 ? [`dont ${emailAmount(notDeclarable)} pas encore déclarables`] : []),
].join(' · ');

/** « Client : Ical Booking », or « Client sans nom » when the client carries no name at all (rule 21). */
function placeholderClientDetail(stay) {
  const name = [stay.firstName, stay.lastName].map((s) => String(s == null ? '' : s).trim()).filter(Boolean).join(' ');
  return name ? `Client : ${name}` : 'Client sans nom';
}

/** « Taxe calculée : 7,20 € » */
const expectedTaxDetail = (amount) => `Taxe calculée : ${emailAmount(amount)}`;

/**
 * One check of the payload: its catalogue entry, the whole count and the first ITEM_LIMIT items.
 * @param {string} key a key of CHECKS
 * @param {Array<object>} items every item the check holds, already in display order
 */
function buildCheck(key, items) {
  const def = CHECKS.find((c) => c.key === key);
  if (!def) throw new Error(`unknown data check ${key}`);
  const list = Array.isArray(items) ? items : [];
  const shown = list.slice(0, ITEM_LIMIT);
  return {
    key: def.key,
    severity: def.severity,
    label: def.label,
    hint: def.hint,
    count: list.length,
    moreCount: list.length - shown.length,
    items: shown,
  };
}

/** The checks in panel order (severity first, then the catalogue's order) and how many hold anything. */
function assemble(checks) {
  const rank = (c) => SEVERITIES.indexOf(c.severity) * 100 + CHECKS.findIndex((d) => d.key === c.key);
  const ordered = [...checks].sort((a, b) => rank(a) - rank(b));
  return { pendingCount: ordered.filter((c) => c.count > 0).length, checks: ordered };
}

module.exports = {
  ITEM_LIMIT, SEVERITIES, CHECKS, stayLabel, monthItemLabel, undeclaredDetail, placeholderClientDetail, expectedTaxDetail, buildCheck, assemble,
};
