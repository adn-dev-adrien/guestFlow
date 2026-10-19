/**
 * The « Paramètres » submenu (specs/settings-rationalization.md rules 1-2): same format as the other
 * sidebar submenus (small MUI icon + text), entries ordered by family, a thin divider between
 * families. `null` marks a divider. The sidebar, the route roles and « is this a settings page? »
 * all read this list, so an entry is declared once.
 *
 * Rules 24–27 (UI/UX review 2026-10-18, proposal 20 and decision 12): the four families are the four
 * named groups of SETTINGS_GROUPS, in order — the sidebar shows the groups and unfolds the one of the
 * open page; the summary page (`/settings`) lists every group with its pages, and its search reads
 * SETTINGS_KEYWORDS (rule 29: the emails by their names, constants/emailNames.js). A plugin entry belongs to the group of the entry it is placed next to.
 *
 * Entry: { path, label, Icon, matches? } — `matches` lists the other paths that open the submenu on
 * this entry (legacy or detail routes).
 */
import BusinessIcon from '@mui/icons-material/Business';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import StorefrontIcon from '@mui/icons-material/Storefront';
import GavelIcon from '@mui/icons-material/Gavel';
import ExtensionIcon from '@mui/icons-material/Extension';
import DateRangeIcon from '@mui/icons-material/DateRange';
import PercentIcon from '@mui/icons-material/Percent';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import CableIcon from '@mui/icons-material/Cable';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import SettingsApplicationsIcon from '@mui/icons-material/SettingsApplications';
import PowerIcon from '@mui/icons-material/Power';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import NightShelterIcon from '@mui/icons-material/NightShelter';
import ForwardToInboxIcon from '@mui/icons-material/ForwardToInbox';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import NotesIcon from '@mui/icons-material/Notes';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import PLUGIN_MODULES from '../plugins';
import { EMAIL_DISPLAY_NAMES } from './emailNames';

export const PROPERTIES_PATH = '/properties';
// The summary page (rule 24). Its `#<group id>` opens the summary on that group.
export const SETTINGS_HOME_PATH = '/settings';

const BASE_MENU = [
  { path: '/settings/etablissement', label: 'Établissement', Icon: BusinessIcon },
  { path: PROPERTIES_PATH, label: 'Logements', Icon: HomeWorkIcon },
  { path: '/settings/plateformes', label: 'Plateformes', Icon: StorefrontIcon },
  { path: '/parametres/conditions-generales', label: 'Conditions générales', Icon: GavelIcon },
  null,
  { path: '/parametres/options-ressources', label: 'Options & ressources', Icon: ExtensionIcon, matches: ['/options', '/resources'] },
  // Named after what it holds: the school holidays only while their plugin is live.
  { path: '/parametres/vacances-fermetures', label: 'Fermetures', labelWith: { plugin: 'school-holidays', label: 'Vacances & fermetures' }, Icon: DateRangeIcon, matches: ['/school-holidays', '/establishment-closures'] },
  null,
  { path: '/settings/tva-exercice', label: 'TVA & exercice', Icon: PercentIcon },
  { path: '/settings/emails', label: 'Emails & notifications', Icon: AlternateEmailIcon, matches: ['/settings/emails/textes'] },
  null,
  { path: '/settings/utilisateurs', label: 'Utilisateurs', Icon: AdminPanelSettingsIcon },
  // specs/hosting-h2-account-security.md rule 15 — shown on a managed instance only (constants/roles.js).
  { path: '/parametres/acces-support', label: 'Accès du support', Icon: SupportAgentIcon },
  // Rule 26 — next to Plugins, whose settings it mostly holds.
  { path: '/settings/integrations', label: 'Intégrations', Icon: CableIcon },
  { path: '/settings/systeme', label: 'Système', Icon: SettingsApplicationsIcon },
  { path: '/parametres/plugins', label: 'Plugins', Icon: PowerIcon },
];

// Entries of plugin modules (specs/plugins-phase-1-sdk.md rule 13, slot `settings.menu`), each placed
// right after the entry its `after` names — or right before the one its `before` names, to open a
// family (specs/plugins-phase-3a-online-payment.md rule 17).
function withModuleEntries(menu, modules) {
  const out = [...menu];
  modules.forEach((mod) => ((mod.contributes && mod.contributes['settings.menu']) || []).forEach((entry) => {
    const { after, before, ...item } = entry;
    if (before) {
      const at = out.findIndex((e) => e && e.path === before);
      out.splice(at === -1 ? out.length : at, 0, item);
      return;
    }
    const at = out.findIndex((e) => e && e.path === after);
    out.splice(at === -1 ? out.length : at + 1, 0, item);
  }));
  return out;
}

export const SETTINGS_MENU = withModuleEntries(BASE_MENU, PLUGIN_MODULES);

export const SETTINGS_ENTRIES = SETTINGS_MENU.filter(Boolean);

/**
 * The submenu as one user sees it: the entries `isVisible` accepts, with the dividers that no longer
 * separate two families dropped (a family can empty out when its plugins are inactive —
 * specs/plugins-phase-0-foundation.md rule 16).
 */
export function visibleSettingsMenu(isVisible, isPluginLive = () => true) {
  const kept = SETTINGS_MENU.filter((entry) => !entry || isVisible(entry.path))
    .map((entry) => (entry && entry.labelWith && isPluginLive(entry.labelWith.plugin) ? { ...entry, label: entry.labelWith.label } : entry));
  return kept.filter((entry, i) => entry || (i > 0 && kept[i - 1] && kept.slice(i + 1).some(Boolean)));
}

/** Rule 26 — the four groups, in the order of the families of SETTINGS_MENU. */
export const SETTINGS_GROUPS = Object.freeze([
  { id: 'etablissement', label: 'Établissement', Icon: BusinessIcon },
  { id: 'sejours', label: 'Séjours', Icon: NightShelterIcon },
  { id: 'paiements-emails', label: 'Paiements et emails', Icon: ForwardToInboxIcon },
  { id: 'compte-systeme', label: 'Compte et système', Icon: ManageAccountsIcon },
]);

// Rule 24 — the rows the summary lists besides the submenu's entries, in the group they belong to.
const SUMMARY_EXTRAS = Object.freeze([
  { path: '/settings/emails/textes', label: 'Textes des emails', Icon: NotesIcon, group: 'paiements-emails', after: '/settings/emails' },
  { path: '/mon-compte', label: 'Mon compte', Icon: AccountCircleIcon, group: 'compte-systeme' },
]);

/**
 * Rule 27 — what the summary's search also understands, page by page: the words an owner types
 * (« wifi », « iban », « smtp », « 2fa »), written as the row then shows them (« Contient : Wi-Fi »).
 */
export const SETTINGS_KEYWORDS = Object.freeze({
  '/settings/etablissement': ['IBAN', 'BIC', 'Banque', 'SIRET', 'TVA intracommunautaire', 'Logo', 'Adresse', 'Téléphone', 'Raison sociale', 'Pied de devis', 'Code portail'],
  [PROPERTIES_PATH]: ['Wi-Fi', 'Adresse du logement', 'Code de la boîte à clés', 'Accès', 'Caution', 'Ménage', 'Linge de lit', 'Serviettes', 'Tarifs', 'Saisons', 'Taxe de séjour', 'Acompte', 'Calendrier iCal', 'Photos', 'Lits'],
  '/settings/plateformes': ['Airbnb', 'Booking', 'Abritel', 'Gîtes de France', 'Commission', 'iCal'],
  '/parametres/conditions-generales': ['CGV', 'CGL', 'Conditions de vente', 'Annulation'],
  '/parametres/options-ressources': ['Options', 'Repas', 'Petit-déjeuner', 'Planche', 'Bain nordique', 'Sauna', 'Ressources', 'Traductions'],
  '/parametres/recettes': ['Tarifs', 'Prix', 'Saisons', 'Dégressivité', 'Durée minimale'],
  '/parametres/vacances-fermetures': ['Vacances scolaires', 'Zone A', 'Zone B', 'Zone C', 'Fermeture', 'Congés'],
  '/parametres/stock-blanchisserie': ['Linge', 'Draps', 'Serviettes', 'Blanchisserie', 'Stock'],
  '/parametres/paiements': ['Qonto', 'Lien de paiement', 'Carte bancaire', 'Paiement en ligne'],
  '/settings/tva-exercice': ['TVA', 'Taux', 'Exercice comptable', 'Clôture', 'Objectif de chiffre d’affaires'],
  '/settings/emails': ['SMTP', 'Serveur d’envoi', 'Mot de passe d’application', 'Gmail', 'Expéditeur', 'Adresse d’envoi', 'Notifications', 'Push', 'Mail de test'],
  // Rule 29 — the emails by the names every page gives them (« Accès et arrivée », « Rappel de solde »).
  '/settings/emails/textes': [...new Set([...Object.values(EMAIL_DISPLAY_NAMES), 'Message', 'Phrase', 'Traduction', 'Anglais', 'Variables', 'Modèle'])],
  '/settings/utilisateurs': ['Compte', 'Rôle', 'Comptable', 'Accueil', 'Administrateur', 'Invitation'],
  '/parametres/acces-support': ['Support', 'Assistance', 'Accès temporaire'],
  '/settings/integrations': ['Google Agenda', 'Neat', 'Assurance annulation', 'Météo-France', 'Sowel', 'Portail', 'WordPress', 'Site internet', 'Clé API'],
  '/settings/systeme': ['Mise à jour', 'Version', 'URL publique', 'Adresse de l’application', 'Traductions', 'Sauvegarde'],
  '/parametres/plugins': ['Plugin', 'Extension', 'Module', 'Activer', 'Désactiver'],
  '/mon-compte': ['Mot de passe', 'Second code', '2FA', 'Double authentification', 'Code par email', 'Appli d’authentification', 'Prénom', 'Email de connexion'],
});

// The group of each entry of SETTINGS_MENU: the index of its family (the dividers before it).
function groupIds(menu) {
  const out = new Map();
  let family = 0;
  menu.forEach((entry) => {
    if (!entry) { family += 1; return; }
    out.set(entry.path, (SETTINGS_GROUPS[family] || SETTINGS_GROUPS[SETTINGS_GROUPS.length - 1]).id);
  });
  return out;
}
const GROUP_OF = groupIds(SETTINGS_MENU);

/**
 * Rules 24, 26 — the groups as one user sees them, each with its visible pages; a group with none
 * is left out. `withExtras` adds the summary-only rows (Textes des emails, Mon compte).
 */
export function visibleSettingsGroups(isVisible, isPluginLive = () => true, { withExtras = false } = {}) {
  const entries = visibleSettingsMenu(isVisible, isPluginLive).filter(Boolean);
  return SETTINGS_GROUPS.map((group) => {
    const own = entries.filter((e) => GROUP_OF.get(e.path) === group.id);
    if (withExtras) {
      SUMMARY_EXTRAS.filter((x) => x.group === group.id && isVisible(x.path === '/settings/emails/textes' ? '/settings/emails' : x.path))
        .forEach((x) => {
          const at = x.after ? own.findIndex((e) => e.path === x.after) : -1;
          own.splice(at === -1 ? own.length : at + 1, 0, x);
        });
    }
    return { ...group, entries: own };
  }).filter((group) => group.entries.length > 0);
}

/**
 * Rule 26 — the group the sidebar unfolds: the one of the open page, or the one the summary was
 * opened on (`#<group id>`); null on the summary alone and outside Paramètres.
 */
export function settingsGroupOf(pathname, hash = '') {
  if (pathname === SETTINGS_HOME_PATH) {
    const id = String(hash || '').replace(/^#/, '');
    return SETTINGS_GROUPS.some((g) => g.id === id) ? id : null;
  }
  const entry = SETTINGS_ENTRIES.find((e) => pathname === e.path
    || (e.matches || []).includes(pathname)
    || (e.path === PROPERTIES_PATH && pathname.startsWith(`${PROPERTIES_PATH}/`)));
  return entry ? GROUP_OF.get(entry.path) || null : null;
}

/** Every path under « Paramètres » — for the role gate of the parent entry. */
export const SETTINGS_PATHS = SETTINGS_ENTRIES.flatMap((e) => [e.path, ...(e.matches || [])]);

/** True when the current page belongs to « Paramètres » (opens the submenu, highlights the parent). */
export function isSettingsPath(pathname) {
  return pathname === SETTINGS_HOME_PATH || SETTINGS_ENTRIES.some((e) => pathname === e.path
    || (e.matches || []).includes(pathname)
    || (e.path === PROPERTIES_PATH && pathname.startsWith(`${PROPERTIES_PATH}/`)));
}

/** The entry a page highlights in the submenu (a property page highlights « Logements » only via its sub-list). */
export function isEntrySelected(entry, pathname) {
  return pathname === entry.path || (entry.matches || []).includes(pathname);
}
