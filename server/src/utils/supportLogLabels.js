/**
 * The support access log as the customer reads it (specs/hosting-h2-account-security.md rule 20):
 * « Réservation 12 modifiée », « Page ouverte : Réservations », « Refusé » — never a method, a raw
 * path or an HTTP status. The table keeps the raw request (method, path, status); this module words
 * it when Paramètres › Accès du support asks for it.
 */

// A page of the application → its name, the menu's wording. `:id` pages take the number.
const PAGES = [
  [/^\/$/, () => 'Tableau de bord'],
  [/^\/planning$/, () => 'Planning'],
  [/^\/calendar$/, () => 'Calendrier'],
  [/^\/reservations\/new$/, () => 'Nouvelle réservation'],
  [/^\/reservations\/upcoming$/, () => 'Réservations à venir'],
  [/^\/reservations\/(\d+)$/, (m) => `Réservation ${m[1]}`],
  [/^\/finance\/tourist-tax$/, () => 'Taxe de séjour'],
  [/^\/finance(\/|$)/, () => 'Suivi financier'],
  [/^\/devis$/, () => 'Devis'],
  [/^\/emails\/historique$/, () => 'Historique des emails'],
  [/^\/emails(\/|$)/, () => 'Emails'],
  [/^\/clients$/, () => 'Clients'],
  [/^\/properties\/(\d+)(\/|$)/, (m) => `Logement ${m[1]}`],
  [/^\/properties$/, () => 'Logements'],
  [/^\/(options|resources)$/, () => 'Options & ressources'],
  [/^\/establishment-closures$/, () => 'Fermetures'],
  [/^\/mon-compte$/, () => 'Mon compte'],
  [/^\/settings\/etablissement$/, () => 'Paramètres › Établissement'],
  [/^\/settings\/plateformes$/, () => 'Paramètres › Plateformes'],
  [/^\/settings\/tva-exercice$/, () => 'Paramètres › TVA & exercice'],
  [/^\/settings\/emails(\/|$)/, () => 'Paramètres › Emails & notifications'],
  [/^\/settings\/integrations$/, () => 'Paramètres › Intégrations'],
  [/^\/settings\/utilisateurs$/, () => 'Paramètres › Utilisateurs'],
  [/^\/settings\/systeme$/, () => 'Paramètres › Système'],
  [/^\/parametres\/conditions-generales$/, () => 'Paramètres › Conditions générales'],
  [/^\/parametres\/options-ressources$/, () => 'Paramètres › Options & ressources'],
  [/^\/parametres\/vacances-fermetures$/, () => 'Paramètres › Fermetures'],
  [/^\/parametres\/plugins$/, () => 'Paramètres › Plugins'],
  [/^\/parametres\/acces-support$/, () => 'Paramètres › Accès du support'],
  [/^\/(settings|parametres)(\/|$)/, () => 'Paramètres'],
];

// An API section → the thing it changes. `f` gives the participle its feminine ending.
const ENTITIES = {
  reservations: { name: 'Réservation', plural: 'Réservations', f: true },
  clients: { name: 'Client', plural: 'Clients' },
  properties: { name: 'Logement', plural: 'Logements' },
  options: { name: 'Option', plural: 'Options', f: true },
  resources: { name: 'Ressource', plural: 'Ressources', f: true },
  platforms: { name: 'Plateforme', plural: 'Plateformes', f: true },
  devis: { name: 'Devis', plural: 'Devis' },
  'calendar-notes': { name: 'Note du calendrier', plural: 'Notes du calendrier', f: true },
  'establishment-closures': { name: 'Fermeture', plural: 'Fermetures', f: true },
  'email-templates': { name: 'Modèle d’email', plural: 'Modèles d’email' },
  'resource-bookings': { name: 'Réservation de ressource', plural: 'Réservations de ressources', f: true },
};
// A section with no single object: « Paramètres modifiés » reads worse than « Modification : Paramètres ».
const SECTIONS = {
  settings: 'Paramètres',
  finance: 'Suivi financier',
  accounting: 'Comptabilité',
  planning: 'Planning',
  dashboard: 'Tableau de bord',
  payments: 'Paiements',
  emails: 'Emails',
  'email-sequence': 'Emails',
  'stay-texts': 'Textes du séjour',
  translations: 'Traductions',
  terms: 'Conditions générales',
  system: 'Système',
  plugins: 'Plugins',
  users: 'Utilisateurs',
  'public-holidays': 'Jours fériés',
  'school-holidays': 'Vacances scolaires',
  laundry: 'Linge',
  ical: 'Calendriers synchronisés',
  'google-calendar': 'Google Agenda',
  neat: 'Assurance',
  'tariff-recipes': 'Tarifs',
  'gdf-intake': 'Gîtes de France',
  onboarding: 'Démarrage',
  subscription: 'Abonnement',
  'support-access': 'Accès du support',
  auth: 'Compte',
};

const VERBS = { POST: 'créé', PUT: 'modifié', PATCH: 'modifié', DELETE: 'supprimé', GET: 'consulté' };

function pageName(path) {
  const clean = String(path || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const hit = PAGES.find(([re]) => re.test(clean));
  return hit ? hit[1](clean.match(hit[0])) : null;
}

function requestLabel(method, path) {
  const segments = String(path || '').toLowerCase().replace(/^\/api/, '').split('/').filter(Boolean);
  const [section, id, ...rest] = segments;
  const read = method === 'GET';
  const entity = ENTITIES[section];
  if (entity) {
    const numbered = /^\d+$/.test(id || '');
    // A sub-action on one object (« …/12/payment-links ») changes that object.
    const verb = numbered && rest.length && !read ? 'modifié' : VERBS[method] || 'modifié';
    const participle = `${verb}${entity.f ? 'e' : ''}`;
    if (numbered) return `${entity.name} ${id} ${participle}`;
    if (!read && method === 'POST' && !id) return `${entity.name} ${participle}`;
  }
  const name = SECTIONS[section] || (entity ? entity.plural : null);
  if (read) return name ? `Consultation : ${name}` : 'Consultation';
  return name ? `Modification : ${name}` : 'Modification';
}

// What a successful read shows: « Réservation 12 », « Planning », or null when it names nothing.
function readTarget(method, path, summary) {
  if (method === 'PAGE') return pageName(path);
  if (method !== 'GET') return undefined;
  const status = Number(summary);
  if (Number.isInteger(status) && status >= 400) return undefined;
  const [section, id] = String(path || '').toLowerCase().split(/[?#]/)[0].replace(/^\/api/, '').split('/').filter(Boolean);
  const entity = ENTITIES[section];
  if (entity && /^\d+$/.test(id || '')) return `${entity.name} ${id}`;
  return SECTIONS[section] || (entity ? entity.plural : null);
}

/**
 * specs/hosting-h2-account-security.md rule 25 — the log as the customer reads it: the successful reads
 * of one minute in a row (pages opened and the API calls behind them) fold into one line
 * « Consultation : Planning, Linge », each name once; writes and refusals keep their own line.
 * `rows` newest first, as stored. → [{ at, label, outcomeLabel }]
 */
function journal(rows) {
  const out = [];
  let group = null;
  const flush = () => {
    if (!group) return;
    const names = [...new Set(group.names.reverse().filter(Boolean))];
    out.push({ at: group.at, label: names.length ? `Consultation : ${names.join(', ')}` : 'Consultation', outcomeLabel: '' });
    group = null;
  };
  for (const row of rows) {
    const target = row.method === 'LOGIN' ? undefined : readTarget(row.method, row.path, row.summary);
    if (target === undefined) {
      flush();
      out.push({ at: row.at, ...describe(row) });
      continue;
    }
    const minute = String(row.at || '').slice(0, 16);
    if (!group || group.minute !== minute) {
      flush();
      group = { at: row.at, minute, names: [] };
    }
    group.names.push(target);
  }
  flush();
  return out;
}

// A stored log row → { label, outcomeLabel }.
function describe({ method, path, summary }) {
  if (method === 'LOGIN') return { label: 'Connexion du support', outcomeLabel: '' };
  if (method === 'PAGE') {
    const name = pageName(path);
    return { label: name ? `Page ouverte : ${name}` : 'Page ouverte', outcomeLabel: '' };
  }
  const status = Number(summary);
  const refused = Number.isInteger(status) && status >= 400;
  // Rule 60 — the client left before the answer: the write may or may not have gone through.
  const outcomeLabel = summary === 'aborted' ? 'Interrompu' : refused ? 'Refusé' : method === 'GET' ? '' : 'Effectué';
  return { label: requestLabel(method, path), outcomeLabel };
}

module.exports = { describe, journal, pageName, requestLabel, readTarget };
