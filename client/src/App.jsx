import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';

// Set dayjs locale globally to French
dayjs.locale('fr');

import { ThemeProvider, CssBaseline } from '@mui/material';
import {
  AppBar, Toolbar, Typography, Drawer, List, ListItemButton, ListItemIcon,
  ListItemText, Box, IconButton, useMediaQuery, Collapse,
  CircularProgress
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useDynamicFavicon } from './hooks/useDynamicFavicon';
import { ADMIN, ACCOUNTANT, RECEPTION, userHasRole, canSeeRoute, canSeeAnyRoute } from './constants/roles';
import OnboardingPage from './pages/OnboardingPage';
import { onboardingRoute } from './utils/onboardingRoute';
import LoginPage from './pages/LoginPage';
import ForcedPasswordChangePage from './pages/ForcedPasswordChangePage';
import LazyPage, { lazyPage } from './components/LazyPage';
import { preloadRoute, prefetchOnIdle } from './utils/pagePreload';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import EventIcon from '@mui/icons-material/Event';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import DescriptionIcon from '@mui/icons-material/Description';
import MailOutlineIcon from '@mui/icons-material/MailOutlined';
import SettingsIcon from '@mui/icons-material/Settings';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import theme from './theme';
import DialogProvider from './components/DialogProvider';
import EmailVerifyBanner from './components/EmailVerifyBanner';
import SubscriptionBanner from './components/SubscriptionBanner';
import PluginLoadBanner from './components/PluginLoadBanner';
import SupportAccessBanner from './components/SupportAccessBanner';
import SupportSessionBar, { SUPPORT_BAR_HEIGHT } from './components/SupportSessionBar';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ReservationSearchBox from './components/ReservationSearchBox';
import { withFrom } from './utils/navigation';
import api from './api';
import { PLATFORM_COLORS, PLATFORM_TEXT_COLORS, normalizePlatformKey, setPlatformDisplayNames } from './constants/platforms';
import {
  visibleSettingsGroups, settingsGroupOf, SETTINGS_HOME_PATH, SETTINGS_PATHS, PROPERTIES_PATH, isSettingsPath, isEntrySelected,
} from './constants/settingsMenu';
import { CALENDAR_ENTRIES, CALENDAR_PATHS, isCalendarPath } from './constants/calendarMenu';
import { isPluginEnabled, isRouteEnabled, SAS } from './constants/plugins';
import { FINANCE_MENU, COMPENSATIONS_PATH, canSeeFinanceEntry, isFinancePath } from './constants/financeMenu';
import { allContributions } from './plugins/sdk/registry';
import { DATA_CHANGED_EVENT } from './constants/appEvents';
import ScrollToTop from './components/ScrollToTop';
import UpdateProgressOverlay from './components/UpdateProgressOverlay';
import AppVersionBadge, { AppVersionFooter } from './components/AppVersionBadge';
import { PageTitleProvider, TopBarActionSlot, usePageTitle, useSetTopBarTitleRoom } from './hooks/usePageTitle';
import RouteErrorBoundary from './components/ErrorBoundary';
import NotFoundPage from './components/NotFoundPage';

// Every page is loaded on demand (specs/inte-performance.md rule 2); the shell stays eager.
const EmailTextsSettingsPage = lazyPage(() => import('./pages/settings/EmailTextsSettingsPage'));
const UserManagementPage = lazyPage(() => import('./pages/UserManagementPage'));
const SupportAccessPage = lazyPage(() => import('./pages/settings/SupportAccessPage'));
const SettingsHomePage = lazyPage(() => import('./pages/settings/SettingsHomePage'));
const Dashboard = lazyPage(() => import('./pages/Dashboard'));
const ClientsPage = lazyPage(() => import('./pages/ClientsPage'));
const PropertiesPage = lazyPage(() => import('./pages/PropertiesPage'));
const PropertyDetail = lazyPage(() => import('./pages/PropertyDetail'));
const PropertyPricingSeasonsPage = lazyPage(() => import('./pages/PropertyPricingSeasonsPage'));
const CalendarPage = lazyPage(() => import('./pages/CalendarPage'));
const ReservationPage = lazyPage(() => import('./pages/ReservationPage'));
const ReservationsUpcomingPage = lazyPage(() => import('./pages/ReservationsUpcomingPage'));
const FinancePage = lazyPage(() => import('./pages/FinancePage'));
const TouristTaxPage = lazyPage(() => import('./pages/TouristTaxPage'));
const PlanningPage = lazyPage(() => import('./pages/PlanningPage'));
const EstablishmentSettingsPage = lazyPage(() => import('./pages/settings/EstablishmentSettingsPage'));
const PlatformsSettingsPage = lazyPage(() => import('./pages/settings/PlatformsSettingsPage'));
const VatFiscalSettingsPage = lazyPage(() => import('./pages/settings/VatFiscalSettingsPage'));
const EmailSettingsPage = lazyPage(() => import('./pages/settings/EmailSettingsPage'));
const IntegrationsSettingsPage = lazyPage(() => import('./pages/settings/IntegrationsSettingsPage'));
const SystemSettingsPage = lazyPage(() => import('./pages/settings/SystemSettingsPage'));
const TermsSettingsPage = lazyPage(() => import('./pages/settings/TermsSettingsPage'));
const PluginsPage = lazyPage(() => import('./pages/PluginsPage'));
const AccountPage = lazyPage(() => import('./pages/AccountPage'));
const SeasonsClosuresPage = lazyPage(() => import('./pages/SeasonsClosuresPage'));
const OptionsResourcesPage = lazyPage(() => import('./pages/OptionsResourcesPage'));
const EstablishmentClosuresPage = lazyPage(() => import('./pages/EstablishmentClosuresPage'));
const DevisPage = lazyPage(() => import('./pages/DevisPage'));
const CompensationsPage = lazyPage(() => import('./pages/CompensationsPage'));
const EmailTemplatesPage = lazyPage(() => import('./pages/EmailTemplatesPage'));
const EmailHistoryPage = lazyPage(() => import('./pages/EmailHistoryPage'));

// The page behind each route, to start its chunk before the router asks for it (rule 10).
const PAGE_ROUTES = [
  ['/', Dashboard],
  ['/clients', ClientsPage],
  ['/properties', PropertiesPage],
  ['/properties/:id', PropertyDetail],
  ['/properties/:id/pricing-seasons', PropertyPricingSeasonsPage],
  ['/calendar', CalendarPage],
  ['/reservations/new', ReservationPage],
  ['/reservations/upcoming', ReservationsUpcomingPage],
  ['/reservations/:reservationId', ReservationPage],
  ['/devis', DevisPage],
  ['/finance', FinancePage],
  ['/finance/tourist-tax', TouristTaxPage],
  ['/planning', PlanningPage],
  ['/establishment-closures', EstablishmentClosuresPage],
  ['/settings', SettingsHomePage],
  ['/settings/etablissement', EstablishmentSettingsPage],
  ['/settings/plateformes', PlatformsSettingsPage],
  ['/settings/tva-exercice', VatFiscalSettingsPage],
  ['/settings/emails', EmailSettingsPage],
  ['/settings/emails/textes', EmailTextsSettingsPage],
  ['/settings/integrations', IntegrationsSettingsPage],
  ['/settings/systeme', SystemSettingsPage],
  ['/settings/utilisateurs', UserManagementPage],
  ['/parametres/vacances-fermetures', SeasonsClosuresPage],
  ['/parametres/options-ressources', OptionsResourcesPage],
  ['/parametres/conditions-generales', TermsSettingsPage],
  ['/parametres/plugins', PluginsPage],
  ['/parametres/acces-support', SupportAccessPage],
  ['/mon-compte', AccountPage],
  ['/emails', EmailTemplatesPage],
  ['/emails/historique', EmailHistoryPage],
];
// Opened all day: fetched when the browser is idle. The heavy ones (finance charts) and the settings wait for a visit.
const IDLE_PAGES = [Dashboard, PlanningPage, CalendarPage, ReservationPage, ClientsPage, EmailTemplatesPage, DevisPage];
preloadRoute(PAGE_ROUTES, window.location.pathname);

const MODULE_PAGES = allContributions('routes');

// 256 px, labels wrap rather than being cut (specs/shell-and-home-day-first.md rule 17).
const DRAWER_WIDTH = 256;

const navItems = [
  { label: 'Tableau de bord', path: '/', icon: <DashboardIcon /> },
  { label: 'Planning', path: '/planning', icon: <CalendarMonthIcon /> },
  { label: 'Calendrier', path: '/calendar', icon: <EventIcon /> },
  { label: 'Suivi financier', path: '/finance', icon: <AccountBalanceIcon /> },
  { label: 'Devis', path: '/devis', icon: <DescriptionIcon /> },
  { label: 'Emails', path: '/emails', icon: <MailOutlineIcon /> },
  // « Clients » is the guest directory, not a setting (specs/settings-rationalization.md rule 5).
  { label: 'Clients', path: '/clients', icon: <PeopleIcon /> },
  { label: 'Paramètres', path: '/settings', icon: <SettingsIcon /> },
];

// Children-of-each-parent map — keeps the parent visibility decision in one place. Hard-coded
// (matches the JSX below) instead of derived from ROUTE_ROLES because the JSX itself is hand-rolled
// and the children's order matters for display. « Suivi financier » reads constants/financeMenu.js.
const CALENDAR_CHILDREN  = ['/calendar', ...CALENDAR_PATHS];
const EMAILS_CHILDREN    = ['/emails', '/emails/historique'];
const SETTINGS_CHILDREN  = ['/settings', ...SETTINGS_PATHS];

// A group's chevron: its own button, beside the row, reachable with the keyboard and saying whether the
// group is open (specs/shell-and-home-day-first.md rule 18).
function NavChevron({ open, label, onToggle, controls }) {
  return (
    <IconButton
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={`${open ? 'Replier' : 'Déplier'} ${label}`}
      onClick={onToggle}
      sx={{ width: 40, height: 40, flexShrink: 0, color: 'text.secondary' }}
    >
      {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
    </IconButton>
  );
}

// Wrapped labels instead of « Conditions génér… » (rule 17).
const WRAP = { overflowWrap: 'anywhere' };

function NavContent({ onItemClick }) {
  const location = useLocation();
  const { user, logout } = useAuth();
  // Single renderer for every role. Each item is conditionally rendered via canSeeRoute() — so an
  // accountant logged in sees the same shell as an admin, with all admin-only items hidden. Parents
  // (Calendrier, Suivi financier, Paramètres) survive as long as ANY of their children survive.
  // When the parent itself isn't accessible (e.g. accountant + /settings) but a child is, clicking
  // the parent only toggles the submenu — no navigation.
  const can = (path) => canSeeRoute(user, path);
  const canAnyOf = (paths) => canSeeAnyRoute(user, paths);
  const showCalendar = canAnyOf(CALENDAR_CHILDREN);
  const financeEntries = FINANCE_MENU.filter((entry) => canSeeFinanceEntry(user, entry));
  const showFinance  = financeEntries.length > 0;
  const showSettings = canAnyOf(SETTINGS_CHILDREN);

  const [properties, setProperties] = useState([]);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const [emailsMenuOpen, setEmailsMenuOpen] = useState(false);
  const [financeMenuOpen, setFinanceMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [settingsPropertiesMenuOpen, setSettingsPropertiesMenuOpen] = useState(false);
  // A settings group's chevron folds or unfolds it without leaving the page (specs/settings-
  // rationalization.md rule 30); the next page opened goes back to « the group of the open page ».
  const [settingsGroupToggles, setSettingsGroupToggles] = useState({});
  useEffect(() => { setSettingsGroupToggles({}); }, [location.pathname, location.hash]);
  const selectedCalendarPropertyId = new URLSearchParams(location.search).get('propertyId');

  // Read once, then again after a write (a property added or renamed), not on every page change
  // (specs/inte-performance.md rule 13).
  useEffect(() => {
    let isMounted = true;
    const read = () => api.getProperties()
      .then((items) => {
        if (isMounted) setProperties(items || []);
      })
      .catch(() => {
        if (isMounted) setProperties([]);
      });
    read();
    window.addEventListener(DATA_CHANGED_EVENT, read);
    return () => {
      isMounted = false;
      window.removeEventListener(DATA_CHANGED_EVENT, read);
    };
  }, []);

  useEffect(() => {
    if (location.pathname.startsWith('/properties')) {
      setCalendarMenuOpen(false);
      setEmailsMenuOpen(false);
      setFinanceMenuOpen(false);
      setSettingsMenuOpen(true);
      setSettingsPropertiesMenuOpen(true);
    }
    if (location.pathname.startsWith('/calendar')) {
      setCalendarMenuOpen(true);
      setEmailsMenuOpen(false);
      setFinanceMenuOpen(false);
      setSettingsMenuOpen(false);
      setSettingsPropertiesMenuOpen(false);
    }
    if (CALENDAR_PATHS.includes(location.pathname)) {
      setCalendarMenuOpen(true);
      setEmailsMenuOpen(false);
      setFinanceMenuOpen(false);
      setSettingsMenuOpen(false);
      setSettingsPropertiesMenuOpen(false);
    }
    if (location.pathname.startsWith('/emails')) {
      setEmailsMenuOpen(true);
      setCalendarMenuOpen(false);
      setFinanceMenuOpen(false);
      setSettingsMenuOpen(false);
      setSettingsPropertiesMenuOpen(false);
    }
    if (isFinancePath(location.pathname)) {
      setFinanceMenuOpen(true);
      setCalendarMenuOpen(false);
      setEmailsMenuOpen(false);
      setSettingsMenuOpen(false);
      setSettingsPropertiesMenuOpen(false);
    }
    if (isSettingsPath(location.pathname) && !location.pathname.startsWith('/properties')) {
      setSettingsMenuOpen(true);
      setCalendarMenuOpen(false);
      setEmailsMenuOpen(false);
      setFinanceMenuOpen(false);
      setSettingsPropertiesMenuOpen(false);
    }
  }, [location.pathname]);

  // Top-level visibility: each item gets a "show if this path or any of its children visible" rule.
  // Items without children appear iff their own path is allowed.
  const visibleNavItems = navItems.filter((item) => {
    if (item.path === '/calendar') return showCalendar;
    if (item.path === '/finance') return showFinance;
    if (item.path === '/settings') return showSettings;
    return can(item.path);
  });

  return (
    <List sx={{ pt: 2 }}>
      {visibleNavItems.map((item) => {
        // When the user cannot navigate to the parent path itself (e.g. accountant on /settings),
        // the top-level row stops being a Link — clicks only toggle the submenu so they can pick
        // their authorised child. Drawer auto-close is also suppressed for these rows so the menu
        // stays expanded on mobile.
        const isParentReachable = can(item.path);
        const isSubmenuParent = item.path === '/calendar' || item.path === '/emails' || item.path === '/finance' || item.path === '/settings';
        const linkProps = isParentReachable ? { component: Link, to: item.path } : {};
        return (
          <Box key={item.path}>
            <Box sx={{ display: 'flex', alignItems: 'center', mx: 1, mb: 0.5 }}>
              <ListItemButton
                {...linkProps}
                onClick={(e) => {
                  if (item.path === '/calendar') {
                    setCalendarMenuOpen(isCalendarPath(location.pathname) ? true : (prev) => !prev);
                    setEmailsMenuOpen(false);
                    setFinanceMenuOpen(false);
                    setSettingsMenuOpen(false);
                  } else if (item.path === '/emails') {
                    setEmailsMenuOpen(location.pathname.startsWith('/emails') ? true : (prev) => !prev);
                    setCalendarMenuOpen(false);
                    setFinanceMenuOpen(false);
                    setSettingsMenuOpen(false);
                  } else if (item.path === '/finance') {
                    setFinanceMenuOpen(isFinancePath(location.pathname) ? true : (prev) => !prev);
                    setCalendarMenuOpen(false);
                    setEmailsMenuOpen(false);
                    setSettingsMenuOpen(false);
                  } else if (item.path === '/settings') {
                    setSettingsMenuOpen(isSettingsPath(location.pathname) ? true : (prev) => !prev);
                    setCalendarMenuOpen(false);
                    setEmailsMenuOpen(false);
                    setFinanceMenuOpen(false);
                    setSettingsPropertiesMenuOpen(location.pathname.startsWith('/properties'));
                  } else {
                    setCalendarMenuOpen(false);
                    setEmailsMenuOpen(false);
                    setFinanceMenuOpen(false);
                    setSettingsMenuOpen(false);
                    setSettingsPropertiesMenuOpen(false);
                  }
                  // Suppress the drawer-close on toggle-only parents so the user can pick their child.
                  if (onItemClick && (isParentReachable || !isSubmenuParent)) onItemClick(e, item.path);
                }}
                selected={
                  item.path === '/properties'
                    ? location.pathname.startsWith('/properties')
                    : item.path === '/emails'
                      ? location.pathname.startsWith('/emails')
                    : item.path === '/finance'
                      ? isFinancePath(location.pathname)
                      : item.path === '/settings'
                        ? isSettingsPath(location.pathname)
                        : location.pathname === item.path
                }
                sx={{ flex: 1, minWidth: 0, borderRadius: 2 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                <ListItemText primary={item.label} slotProps={{ primary: { sx: WRAP } }} />
              </ListItemButton>
              {isSubmenuParent && (
                <NavChevron
                  label={item.label}
                  open={{ '/calendar': calendarMenuOpen, '/emails': emailsMenuOpen, '/finance': financeMenuOpen, '/settings': settingsMenuOpen }[item.path]}
                  onToggle={{
                    '/calendar': () => setCalendarMenuOpen((prev) => !prev),
                    '/emails': () => setEmailsMenuOpen((prev) => !prev),
                    '/finance': () => setFinanceMenuOpen((prev) => !prev),
                    '/settings': () => setSettingsMenuOpen((prev) => !prev),
                  }[item.path]}
                />
              )}
            </Box>
            {item.path === '/calendar' && (
              <Collapse in={calendarMenuOpen} timeout="auto" unmountOnExit>
                <List disablePadding sx={{ px: 1, pb: 0.5 }}>
                  {/* Entries of plugin modules (slot `calendar.menu`), e.g. Calendrier › Ressources. */}
                  {CALENDAR_ENTRIES.filter((entry) => can(entry.path)).map((entry) => (
                  <ListItemButton
                    key={entry.path}
                    component={Link}
                    to={entry.path}
                    onClick={(e) => onItemClick && onItemClick(e, entry.path)}
                    selected={location.pathname === entry.path}
                    sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                  >
                    <ListItemText
                      primary={entry.label}
                      slotProps={{
                        primary: { variant: 'body2', fontStyle: 'italic' }
                      }}
                    />
                  </ListItemButton>
                  ))}
                  {properties.map((p) => (
                    <ListItemButton
                      key={`calendar-${p.id}`}
                      component={Link}
                      to={`/calendar?propertyId=${p.id}`}
                      onClick={(e) => onItemClick && onItemClick(e, `/calendar?propertyId=${p.id}`)}
                      selected={location.pathname === '/calendar' && String(selectedCalendarPropertyId) === String(p.id)}
                      sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                    >
                      <ListItemText
                        primary={p.name}
                        slotProps={{
                          primary: { variant: 'body2', sx: WRAP }
                        }}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Collapse>
            )}
            {item.path === '/emails' && (
              <Collapse in={emailsMenuOpen} timeout="auto" unmountOnExit>
                <List disablePadding sx={{ px: 1, pb: 0.5 }}>
                  {can('/emails') && (
                  <ListItemButton
                    component={Link}
                    to="/emails"
                    onClick={(e) => onItemClick && onItemClick(e, '/emails')}
                    selected={location.pathname === '/emails'}
                    sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                  >
                    <ListItemText primary="Modèles" slotProps={{
                      primary: { variant: 'body2', sx: WRAP }
                    }} />
                  </ListItemButton>
                  )}
                  {can('/emails') && (
                  <ListItemButton
                    component={Link}
                    to="/emails/historique"
                    onClick={(e) => onItemClick && onItemClick(e, '/emails/historique')}
                    selected={location.pathname === '/emails/historique'}
                    sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                  >
                    <ListItemText primary="Historique" slotProps={{
                      primary: { variant: 'body2', sx: WRAP }
                    }} />
                  </ListItemButton>
                  )}
                </List>
              </Collapse>
            )}
            {item.path === '/finance' && (
              <Collapse in={financeMenuOpen} timeout="auto" unmountOnExit>
                <List disablePadding sx={{ px: 1, pb: 0.5 }}>
                  {/* Core entries and the `finance.menu` slot (specs/plugins-phase-2-hosts.md rule 19). */}
                  {financeEntries.map((entry) => (
                  <ListItemButton
                    key={entry.key}
                    component={Link}
                    to={entry.path}
                    onClick={(e) => onItemClick && onItemClick(e, entry.path)}
                    selected={location.pathname === entry.path}
                    sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                  >
                    <ListItemText primary={entry.label} slotProps={{
                      primary: { variant: 'body2', sx: WRAP }
                    }} />
                  </ListItemButton>
                  ))}
                </List>
              </Collapse>
            )}
            {item.path === '/settings' && (
              <Collapse in={settingsMenuOpen} timeout="auto" unmountOnExit>
                <List disablePadding sx={{ px: 1, pb: 0.5 }}>
                  {/* specs/settings-rationalization.md rule 26 — the four groups; the one of the open
                      page (or of the summary's #group) unfolds its pages. constants/settingsMenu.js. */}
                  {visibleSettingsGroups(can, (id) => (user?.enabledPlugins || []).includes(id)).map((group) => {
                    const ofPage = group.id === settingsGroupOf(location.pathname, location.hash);
                    const unfolded = settingsGroupToggles[group.id] ?? ofPage;
                    return (
                      <Box key={group.id}>
                        {/* Rule 30 — the row is a link only; its own chevron folds the group (shell rule 18). */}
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <ListItemButton
                            component={Link}
                            to={`${SETTINGS_HOME_PATH}#${group.id}`}
                            onClick={(e) => onItemClick && onItemClick(e, `${SETTINGS_HOME_PATH}#${group.id}`)}
                            selected={location.pathname === SETTINGS_HOME_PATH && ofPage}
                            sx={{ flex: 1, minWidth: 0, pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                          >
                            <ListItemIcon sx={{ minWidth: 34 }}><group.Icon fontSize="small" /></ListItemIcon>
                            <ListItemText primary={group.label} slotProps={{
                              primary: { variant: 'body2', sx: { ...WRAP, fontWeight: 600 } }
                            }} />
                          </ListItemButton>
                          <NavChevron
                            label={group.label}
                            open={unfolded}
                            controls={`settings-group-${group.id}`}
                            onToggle={() => setSettingsGroupToggles((prev) => ({ ...prev, [group.id]: !unfolded }))}
                          />
                        </Box>
                        {unfolded && (
                        <List disablePadding role="group" id={`settings-group-${group.id}`} aria-label={group.label}>
                        {group.entries.map((entry) => {
                    const isProperties = entry.path === PROPERTIES_PATH;
                    return (
                      <Box key={entry.path}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <ListItemButton
                            component={Link}
                            to={entry.path}
                            onClick={(e) => {
                              if (isProperties) setSettingsPropertiesMenuOpen((prev) => !prev);
                              if (onItemClick) onItemClick(e, entry.path);
                            }}
                            selected={isEntrySelected(entry, location.pathname)}
                            sx={{ flex: 1, minWidth: 0, pl: 7, py: 0.75, borderRadius: 2, mb: 0.25 }}
                          >
                            <ListItemIcon sx={{ minWidth: 34 }}><entry.Icon fontSize="small" /></ListItemIcon>
                            <ListItemText primary={entry.label} slotProps={{
                              primary: { variant: 'body2', sx: WRAP }
                            }} />
                          </ListItemButton>
                          {isProperties && (
                            <NavChevron
                              label={entry.label}
                              open={settingsPropertiesMenuOpen}
                              onToggle={() => setSettingsPropertiesMenuOpen((prev) => !prev)}
                            />
                          )}
                        </Box>
                        {isProperties && (
                          <Collapse in={settingsPropertiesMenuOpen} timeout="auto" unmountOnExit>
                            <List disablePadding sx={{ px: 1, pb: 0.25 }}>
                              {properties.map((p) => (
                                <ListItemButton
                                  key={`settings-property-${p.id}`}
                                  component={Link}
                                  to={`/properties/${p.id}`}
                                  onClick={(e) => onItemClick && onItemClick(e, `/properties/${p.id}`)}
                                  selected={location.pathname === `/properties/${p.id}`}
                                  sx={{ pl: 9, py: 0.65, borderRadius: 2, mb: 0.25 }}
                                >
                                  <ListItemText
                                    primary={p.name}
                                    slotProps={{ primary: { variant: 'body2', sx: WRAP } }}
                                  />
                                </ListItemButton>
                              ))}
                            </List>
                          </Collapse>
                        )}
                      </Box>
                    );
                        })}
                        </List>
                        )}
                      </Box>
                    );
                  })}
                </List>
              </Collapse>
            )}
          </Box>
        );
      })}
      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
        {/* « Mon compte » — every role (specs/settings-rationalization.md rule 6). */}
        <ListItemButton
          component={Link}
          to="/mon-compte"
          onClick={(e) => onItemClick && onItemClick(e, '/mon-compte')}
          selected={location.pathname === '/mon-compte'}
          sx={{ py: 0.75, borderRadius: 2, mx: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 34 }}><AccountCircleIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Mon compte" slotProps={{
            primary: { variant: 'body2' }
          }} />
        </ListItemButton>
        <ListItemButton onClick={() => logout()} sx={{ py: 0.75, borderRadius: 2, mx: 1 }}>
          <ListItemIcon sx={{ minWidth: 34 }}><LogoutIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Se déconnecter" slotProps={{
            primary: { variant: 'body2' }
          }} />
        </ListItemButton>
      </Box>
    </List>
  );
}

// The page action button of a phone's top bar (specs/shell-and-home-day-first.md rule 23) is 44 px wide.
const TOP_BAR_ACTION_WIDTH = 44;

/**
 * Whether the top bar's title keeps its full text beside one more button: the title's natural width
 * against the room the bar leaves it, the action slot and the spacer left out — so the answer does
 * not change when the button moves in or out (rule 23).
 */
function useTopBarTitleRoom(toolbarRef, titleRef, title, active) {
  const setTitleRoom = useSetTopBarTitleRoom();
  useLayoutEffect(() => {
    const bar = toolbarRef.current;
    const heading = titleRef.current;
    if (!active || !bar || !heading) { setTitleRoom(true); return undefined; }
    const measure = () => {
      const style = getComputedStyle(bar);
      const gap = parseFloat(style.columnGap) || 0;
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      let others = 0;
      let items = 0;
      [...bar.children].forEach((child) => {
        if (child === heading || child.hasAttribute('data-topbar-slot') || child.hasAttribute('data-topbar-spacer')) return;
        const box = child.getBoundingClientRect();
        const margins = parseFloat(getComputedStyle(child).marginLeft) + parseFloat(getComputedStyle(child).marginRight);
        if (box.width > 0) { others += box.width + (margins || 0); items += 1; }
      });
      const room = bar.clientWidth - padding - others - gap * (items + 1);
      setTitleRoom(heading.scrollWidth + gap + TOP_BAR_ACTION_WIDTH <= room);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [toolbarRef, titleRef, title, active, setTitleRoom]);
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  useEffect(() => prefetchOnIdle(IDLE_PAGES), []);
  // A page of an inactive plugin is never mounted (rule 18); in its place the 404, which an
  // administrator reads as « Plugin inactif » (specs/plugins-phase-p-productisation.md rule 42).
  const pluginRoute = (path, element) => (isRouteEnabled(user, path) ? element : <NotFoundPage />);
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  // On a phone the top bar names the open page; the home keeps the wordmark
  // (specs/shell-and-home-day-first.md rule 15).
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const pageTitle = usePageTitle();
  const showPageTitle = isPhone && location.pathname !== '/' && Boolean(pageTitle);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Global reservation search lives in the top bar (specs/reservation-number-and-search.md §6).
  // On mobile it collapses behind a magnifier that expands into a full-width field.
  const [searchOpen, setSearchOpen] = useState(false);
  const toolbarRef = useRef(null);
  const titleRef = useRef(null);
  useTopBarTitleRoom(toolbarRef, titleRef, pageTitle, showPageTitle && !searchOpen);
  const handleHeaderSearchSelect = (id) => {
    setSearchOpen(false);
    navigate(withFrom(`/reservations/${id}`, `${location.pathname}${location.search}`));
  };

  // Push the configured company logo into the document's <link rel="icon"> at runtime. Server-side
  // middleware also serves the logo on /favicon.ico in prod, but the CRA dev server :3000 serves
  // public/favicon.ico directly without proxying — this hook covers both modes + sidesteps the
  // browser's aggressive favicon cache via a version-keyed buster.
  // Settings are admin-only: no other role asks for them (specs/reception-role-checkin-only.md rule 14).
  useDynamicFavicon({ refreshKey: user && user.id, enabled: userHasRole(user, ADMIN) });

  // Non-admin roles are confined client-side to their allowed surface (the server already 403s every
  // other endpoint, but we redirect so they don't see empty shells). A user who also holds admin
  // keeps the full app. Combined non-admin roles get the union of their allowed paths.
  // - Accountant → /comptabilite* + « Indemnités d'annulation » + /mon-compte while the accounting
  //   export is live, « Mon compte » alone otherwise (specs/plugins-phase-2-hosts.md rules 3, 21).
  // - Reception  → / + /planning + /mon-compte (specs/reception-role-checkin-only.md).
  // A page of an inactive plugin is not there (specs/plugins-phase-0-foundation.md rule 19): a URL
  // typed by hand lands on the home page, or on « Mon compte » for a role that has no home page.
  // An administrator stays on the address and reads « Plugin inactif » with a way to Plugins
  // (specs/plugins-phase-p-productisation.md rule 42).
  useEffect(() => {
    if (!user || userHasRole(user, ADMIN) || isRouteEnabled(user, location.pathname)) return;
    const hasHome = userHasRole(user, ADMIN) || userHasRole(user, RECEPTION);
    navigate(hasHome ? '/' : '/mon-compte', { replace: true });
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    if (!user || userHasRole(user, ADMIN)) return;
    const isAccountant = userHasRole(user, ACCOUNTANT);
    const isReception = userHasRole(user, RECEPTION);
    if (!isAccountant && !isReception) return;
    const path = location.pathname;
    const own = path === '/mon-compte' || path === '/account';
    const exportLive = canSeeRoute(user, '/comptabilite');
    const accountantPage = exportLive && (path.startsWith('/comptabilite') || path === COMPENSATIONS_PATH);
    const allowed = (isAccountant && (accountantPage || own))
      || (isReception && (path === '/' || path === '/planning' || own));
    if (allowed) return;
    if (isReception) navigate('/', { replace: true });
    else navigate(exportLive ? '/comptabilite' : '/mon-compte', { replace: true });
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    let isMounted = true;
    api.getPlatformColors()
      .then((data) => {
        if (!isMounted) return;
        const customColors = data?.customColors || {};
        // Re-normalize incoming keys so they share the slug shape used by
        // `getPlatformColor`. The server's slug uses dashes
        // (`gites-de-france`); ours strips them (`gitesdefrance`). Without
        // this pass the merged entries would never match any client-side
        // lookup.
        for (const [rawKey, color] of Object.entries(customColors)) {
          const key = normalizePlatformKey(rawKey);
          if (key) PLATFORM_COLORS[key] = color;
        }
        for (const [rawKey, textColor] of Object.entries(data?.textColors || {})) {
          const key = normalizePlatformKey(rawKey);
          if (key) PLATFORM_TEXT_COLORS[key] = textColor;
        }
        setPlatformDisplayNames(data?.displayNames);
      })
      .catch(() => {
        // Keep static colors when custom colors cannot be loaded.
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleNavItemClick = (event, targetPath) => {
    const currentPathWithSearch = `${location.pathname}${location.search || ''}`;
    const isExactSameTarget = targetPath === currentPathWithSearch || (targetPath === location.pathname && !location.search);
    if (isExactSameTarget) {
      if (isMobile) setMobileOpen(false);
      event.preventDefault();
      return;
    }

    const beforeNavigate = window.__guestflowBeforeNavigate;
    if (typeof beforeNavigate === 'function') {
      const blocked = beforeNavigate(targetPath);
      if (blocked) {
        event.preventDefault();
        return;
      }
    }

    if (isMobile) setMobileOpen(false);
    navigate(targetPath);
    event.preventDefault();
  };

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" elevation={0} sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: 'background.paper', color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar ref={toolbarRef} sx={{ gap: 1 }}>
          {isMobile && (
            <IconButton edge="start" aria-label="Ouvrir le menu" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)} sx={{ mr: 0.5 }}>
              <MenuIcon />
            </IconButton>
          )}
          {isMobile && searchOpen ? (
            // Mobile, expanded: the search field takes over the bar, with a close affordance.
            <>
              <Box sx={{ flexGrow: 1 }}>
                <ReservationSearchBox autoFocus onSelect={handleHeaderSearchSelect} />
              </Box>
              <IconButton onClick={() => setSearchOpen(false)} aria-label="Fermer la recherche">
                <CloseIcon />
              </IconButton>
            </>
          ) : (
            <>
              {showPageTitle ? (
                // The page's heading on a phone: the bar's own copy is not drawn there.
                <Typography
                  ref={titleRef}
                  component="h1"
                  title={pageTitle}
                  data-testid="appbar-page-title"
                  sx={{
                    fontFamily: (t) => t.typography.pageTitle.fontFamily, fontWeight: 600, fontSize: '1.1rem',
                    // Never squeezed below a readable word (rule 23): « Logements », not « L… ».
                    lineHeight: 1.25, minWidth: 'min(12ch, 100%)', flexShrink: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {pageTitle}
                </Typography>
              ) : (
                // Wordmark in the « Maison » serif (specs/ds-sweep-planning.md rule 25) — same face
                // as the page titles, keeps the primary green and the h6 size. On a phone's home it
                // is the page's heading: the home's page bar is not drawn there (rule 15).
                <Typography variant="h6" component={isPhone && location.pathname === '/' ? 'h1' : 'p'} sx={{ fontFamily: (t) => t.typography.pageTitle.fontFamily, fontWeight: 700, color: 'primary.main' }}>
                  GuestFlow
                </Typography>
              )}
              {!isMobile && (
                // Desktop: the search field is always visible next to the logo.
                <Box sx={{ ml: 3, flexGrow: 1, maxWidth: 440 }}>
                  <ReservationSearchBox onSelect={handleHeaderSearchSelect} />
                </Box>
              )}
              <Box data-topbar-spacer="" sx={{ flexGrow: 1 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, order: 2 }}>
                {isMobile && (
                  <IconButton onClick={() => setSearchOpen(true)} aria-label="Rechercher une réservation">
                    <SearchIcon />
                  </IconButton>
                )}
                {/* The update offer (specs/self-update-and-releases.md §6.5); the installed version is at the
                    foot of the drawer (specs/shell-and-home-day-first.md rule 16). */}
                <AppVersionBadge />
              </Box>
            </>
          )}
          {/* A phone page's single action (specs/shell-and-home-day-first.md rule 23), placed before the
              search by `order`; mounted, hidden, while the search covers the bar, so the page does not move. */}
          {isPhone && <TopBarActionSlot hidden={searchOpen} />}
        </Toolbar>
      </AppBar>

      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileOpen : true}
        onClose={() => setMobileOpen(false)}
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            border: 'none',
            bgcolor: 'background.default',
          },
        }}
      >
        <Toolbar />
        <NavContent onItemClick={handleNavItemClick} />
        <Box sx={{ mt: 'auto', borderTop: '1px solid', borderColor: 'divider' }}>
          <AppVersionFooter />
        </Box>
      </Drawer>

      {/* A support session's red bar (specs/hosting-h2-account-security.md rule 16). */}
      <SupportSessionBar />
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, px: { xs: 1.5, sm: 2, md: 3 }, py: { xs: 2, md: 3 }, pb: user && user.supportSession ? `calc(${SUPPORT_BAR_HEIGHT + 24}px + env(safe-area-inset-bottom, 0px))` : undefined, mt: 8, bgcolor: 'background.default', minHeight: '100vh' }}>
        {/* Anti-lockout safety net — persistent until the operator has logged in once with the new
            address. See specs/admin-account-management.md follow-up #7 (2026-06-02). */}
        <EmailVerifyBanner />
        {/* The plugin bundles could not be listed (specs/plugins-phase-4-registry.md rule 18). */}
        <PluginLoadBanner />
        {/* Subscription due, in grace or read-only (specs/control-plane-plans-and-access.md §6). */}
        <SubscriptionBanner />
        {/* The support asks for access (specs/hosting-h2-account-security.md rule 12). */}
        <SupportAccessBanner />
        {/* Self-update progress (specs/self-update-and-releases.md §6.3). Mounted at app level so it
            takes over wherever the update was triggered from, and survives a reload mid-update. */}
        <UpdateProgressOverlay />
        {/* Render-crash guard + catch-all 404 (specs/ds-components.md §3.4) — a component throw or
            an unknown URL used to leave the main area blank. */}
        <RouteErrorBoundary>
        {/* A page of an inactive plugin is not even mounted (specs/plugins-phase-0-foundation.md
            rules 18-19): its API calls never leave, and the guard above sends the URL home — or,
            for an administrator, the 404 says « Plugin inactif » (phase P rule 42). */}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {/* Pages of plugin modules (specs/plugins-phase-1-sdk.md rule 15), lazily loaded. */}
          {MODULE_PAGES.map(({ path, Component }) => (
            <Route key={path} path={path} element={pluginRoute(path, <LazyPage><Component /></LazyPage>)} />
          ))}
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/properties" element={<PropertiesPage />} />
          <Route path="/properties/:id" element={<PropertyDetail />} />
          <Route path="/properties/:id/pricing-seasons" element={<PropertyPricingSeasonsPage />} />
          <Route path="/options" element={<Navigate to="/parametres/options-ressources" replace />} />
          <Route path="/resources" element={<Navigate to="/parametres/options-ressources?tab=resources" replace />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/reservations/new" element={<ReservationPage />} />
          <Route path="/reservations/:reservationId" element={<ReservationPage />} />
          <Route path="/reservations/upcoming" element={<ReservationsUpcomingPage />} />
          <Route path="/devis" element={<DevisPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/finance/tourist-tax" element={<TouristTaxPage />} />
          <Route path={COMPENSATIONS_PATH} element={<CompensationsPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/establishment-closures" element={<EstablishmentClosuresPage />} />
          {/* Paramètres (specs/settings-rationalization.md rule 2). */}
          {/* Rule 24 — the summary page, with its search. */}
          <Route path="/settings" element={<SettingsHomePage />} />
          <Route path="/settings/etablissement" element={<EstablishmentSettingsPage />} />
          <Route path="/settings/plateformes" element={<PlatformsSettingsPage />} />
          <Route path="/settings/tva-exercice" element={<VatFiscalSettingsPage />} />
          <Route path="/settings/emails" element={<EmailSettingsPage />} />
          <Route path="/settings/emails/textes" element={<EmailTextsSettingsPage />} />
          <Route path="/settings/integrations" element={pluginRoute('/settings/integrations', <IntegrationsSettingsPage />)} />
          <Route path="/settings/systeme" element={<SystemSettingsPage />} />
          <Route path="/settings/utilisateurs" element={<UserManagementPage />} />
          <Route path="/parametres/tarifs" element={<Navigate to={isPluginEnabled(user, SAS) ? '/parametres/options-ressources?tab=sas' : '/parametres/options-ressources'} replace />} />
          <Route path="/parametres/vacances-fermetures" element={<SeasonsClosuresPage />} />
          <Route path="/parametres/options-ressources" element={<OptionsResourcesPage />} />
          <Route path="/parametres/conditions-generales" element={<TermsSettingsPage />} />
          {/* specs/plugin-operator-provisioning.md rule 3 — no Plugins page where the operator manages the plugins. */}
          <Route path="/parametres/plugins" element={canSeeRoute(user, '/parametres/plugins') ? <PluginsPage /> : <NotFoundPage />} />
          {/* specs/hosting-h2-account-security.md rules 13, 15, 17 — managed instances only. */}
          <Route path="/parametres/acces-support" element={canSeeRoute(user, '/parametres/acces-support') ? <SupportAccessPage /> : <Navigate to="/" replace />} />
          {/* The pre-auth pages, reached with a session (a reset that logged in): home. */}
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/mot-de-passe-oublie" element={<Navigate to="/" replace />} />
          <Route path="/nouveau-mot-de-passe" element={<Navigate to="/" replace />} />
          {/* « Mon compte » — every role (rule 6). Legacy paths redirect to it. */}
          <Route path="/mon-compte" element={<AccountPage />} />
          <Route path="/settings/password" element={<Navigate to="/mon-compte" replace />} />
          <Route path="/comptes" element={<Navigate to="/mon-compte" replace />} />
          <Route path="/account" element={<Navigate to="/mon-compte" replace />} />
          <Route path="/emails"            element={<EmailTemplatesPage />} />
          <Route path="/emails/modeles"    element={<Navigate to="/emails" replace />} />
          <Route path="/emails/historique" element={<EmailHistoryPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </RouteErrorBoundary>
      </Box>
    </Box>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!user) {
    // The forgotten password, before any session (specs/hosting-h2-account-security.md rules 1-4).
    if (location.pathname === '/mot-de-passe-oublie') return <ForgotPasswordPage />;
    if (location.pathname === '/nouveau-mot-de-passe') return <ResetPasswordPage />;
    return <LoginPage />;
  }
  if (user.mustChangePassword) return <ForcedPasswordChangePage />;
  // The start assistant, full screen and outside the side menu (specs/plugins-phase-p-productisation.md
  // rule 20): an admin lands there while it is open, and may reopen it from Réglages › Système (rule 22).
  // Rule 45 — once it is done, `/demarrage` reached by accident goes home instead of restarting at step 1.
  const onboarding = onboardingRoute({
    isAdmin: userHasRole(user, ADMIN), onboardingOpen: user.onboardingOpen, pathname: location.pathname, state: location.state,
  });
  if (onboarding === 'assistant') return <OnboardingPage />;
  if (onboarding === 'home') return <Navigate to="/" replace />;
  return <PageTitleProvider><AppShell /></PageTitleProvider>;
}

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        {/* Pages must open at the top with the sticky bar visible (specs/design-system.md §3.6). */}
        <ScrollToTop />
        <DialogProvider>
          <AuthProvider>
            <AuthGate />
          </AuthProvider>
        </DialogProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
