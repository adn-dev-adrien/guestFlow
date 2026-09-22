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
import MenuBookIcon from '@mui/icons-material/MenuBook';
import DateRangeIcon from '@mui/icons-material/DateRange';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';
import PaymentsIcon from '@mui/icons-material/Payments';
import PercentIcon from '@mui/icons-material/Percent';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import CableIcon from '@mui/icons-material/Cable';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import SettingsApplicationsIcon from '@mui/icons-material/SettingsApplications';

export const PROPERTIES_PATH = '/properties';

export const SETTINGS_MENU = [
  { path: '/settings/etablissement', label: 'Établissement', Icon: BusinessIcon },
  { path: PROPERTIES_PATH, label: 'Logements', Icon: HomeWorkIcon },
  { path: '/settings/plateformes', label: 'Plateformes', Icon: StorefrontIcon },
  { path: '/parametres/conditions-generales', label: 'Conditions générales', Icon: GavelIcon },
  null,
  { path: '/parametres/options-ressources', label: 'Options & ressources', Icon: ExtensionIcon, matches: ['/options', '/resources'] },
  { path: '/parametres/recettes', label: 'Recettes tarifaires', Icon: MenuBookIcon },
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
];

export const SETTINGS_ENTRIES = SETTINGS_MENU.filter(Boolean);

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
