/**
 * The « Paramètres » submenu (specs/settings-rationalization.md rules 1-2): same format as the other
 * sidebar submenus (small MUI icon + text), entries ordered by family, a thin divider between
 * families. `null` marks a divider. The sidebar, the route roles and « is this a settings page? »
 * all read this list, so an entry is declared once.
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
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';
import PaymentsIcon from '@mui/icons-material/Payments';
import PercentIcon from '@mui/icons-material/Percent';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import CableIcon from '@mui/icons-material/Cable';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import SettingsApplicationsIcon from '@mui/icons-material/SettingsApplications';
import PowerIcon from '@mui/icons-material/Power';
import PLUGIN_MODULES from '../plugins';

export const PROPERTIES_PATH = '/properties';

const BASE_MENU = [
  { path: '/settings/etablissement', label: 'Établissement', Icon: BusinessIcon },
  { path: PROPERTIES_PATH, label: 'Logements', Icon: HomeWorkIcon },
  { path: '/settings/plateformes', label: 'Plateformes', Icon: StorefrontIcon },
  { path: '/parametres/conditions-generales', label: 'Conditions générales', Icon: GavelIcon },
  null,
  { path: '/parametres/options-ressources', label: 'Options & ressources', Icon: ExtensionIcon, matches: ['/options', '/resources'] },
  { path: '/parametres/vacances-fermetures', label: 'Vacances & fermetures', Icon: DateRangeIcon, matches: ['/school-holidays', '/establishment-closures'] },
  { path: '/parametres/stock-blanchisserie', label: 'Linge', Icon: LocalLaundryServiceIcon },
  null,
  { path: '/parametres/paiements', label: 'Paiements en ligne', Icon: PaymentsIcon },
  { path: '/settings/tva-exercice', label: 'TVA & exercice', Icon: PercentIcon },
  { path: '/settings/emails', label: 'Emails & notifications', Icon: AlternateEmailIcon },
  { path: '/settings/integrations', label: 'Intégrations', Icon: CableIcon },
  null,
  { path: '/settings/utilisateurs', label: 'Utilisateurs', Icon: AdminPanelSettingsIcon },
  { path: '/settings/systeme', label: 'Système', Icon: SettingsApplicationsIcon },
  { path: '/parametres/plugins', label: 'Plugins', Icon: PowerIcon },
];

// Entries of plugin modules (specs/plugins-phase-1-sdk.md rule 13, slot `settings.menu`), each placed
// right after the entry its `after` names.
function withModuleEntries(menu, modules) {
  const out = [...menu];
  modules.forEach((mod) => ((mod.contributes && mod.contributes['settings.menu']) || []).forEach((entry) => {
    const at = out.findIndex((e) => e && e.path === entry.after);
    const { after, ...item } = entry;
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
export function visibleSettingsMenu(isVisible) {
  const kept = SETTINGS_MENU.filter((entry) => !entry || isVisible(entry.path));
  return kept.filter((entry, i) => entry || (i > 0 && kept[i - 1] && kept.slice(i + 1).some(Boolean)));
}

/** Every path under « Paramètres » — for the role gate of the parent entry. */
export const SETTINGS_PATHS = SETTINGS_ENTRIES.flatMap((e) => [e.path, ...(e.matches || [])]);

/** True when the current page belongs to « Paramètres » (opens the submenu, highlights the parent). */
export function isSettingsPath(pathname) {
  return SETTINGS_ENTRIES.some((e) => pathname === e.path
    || (e.matches || []).includes(pathname)
    || (e.path === PROPERTIES_PATH && pathname.startsWith(`${PROPERTIES_PATH}/`)));
}

/** The entry a page highlights in the submenu (a property page highlights « Logements » only via its sub-list). */
export function isEntrySelected(entry, pathname) {
  return pathname === entry.path || (entry.matches || []).includes(pathname);
}
