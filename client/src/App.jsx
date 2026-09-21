import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';

// Set dayjs locale globally to French
dayjs.locale('fr');

import { ThemeProvider, CssBaseline } from '@mui/material';
import {
  AppBar, Toolbar, Typography, Drawer, List, ListItemButton, ListItemIcon,
  ListItemText, Box, IconButton, useMediaQuery, Collapse, Divider,
  CircularProgress, Card, CardContent
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useDynamicFavicon } from './hooks/useDynamicFavicon';
import { ADMIN, ACCOUNTANT, RECEPTION, userHasRole, canSeeRoute, canSeeAnyRoute } from './constants/roles';
import LoginPage from './pages/LoginPage';
import ChangePasswordForm from './components/ChangePasswordForm';
import UserManagementPage from './pages/UserManagementPage';
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
import ReservationSearchBox from './components/ReservationSearchBox';
import { withFrom } from './utils/navigation';
import api from './api';
import { PLATFORM_COLORS, normalizePlatformKey } from './constants/platforms';
import { SETTINGS_MENU, SETTINGS_PATHS, PROPERTIES_PATH, isSettingsPath, isEntrySelected } from './constants/settingsMenu';

import Dashboard from './pages/Dashboard';
import ClientsPage from './pages/ClientsPage';
import PropertiesPage from './pages/PropertiesPage';
import PropertyDetail from './pages/PropertyDetail';
import PropertyPricingSeasonsPage from './pages/PropertyPricingSeasonsPage';
import TariffRecipesPage from './pages/TariffRecipesPage';
import OptionsPage from './pages/OptionsPage';
import CalendarPage from './pages/CalendarPage';
import ReservationPage from './pages/ReservationPage';
import ReservationsUpcomingPage from './pages/ReservationsUpcomingPage';
import FinancePage from './pages/FinancePage';
import TouristTaxPage from './pages/TouristTaxPage';
import SchoolHolidaysPage from './pages/SchoolHolidaysPage';
import ResourcesPage from './pages/ResourcesPage';
import PlanningPage from './pages/PlanningPage';
import ResourcePlanningPage from './pages/ResourcePlanningPage';
import EstablishmentSettingsPage from './pages/settings/EstablishmentSettingsPage';
import PlatformsSettingsPage from './pages/settings/PlatformsSettingsPage';
import VatFiscalSettingsPage from './pages/settings/VatFiscalSettingsPage';
import EmailSettingsPage from './pages/settings/EmailSettingsPage';
import IntegrationsSettingsPage from './pages/settings/IntegrationsSettingsPage';
import SystemSettingsPage from './pages/settings/SystemSettingsPage';
import AccountPage from './pages/AccountPage';
import LinenStockPage from './pages/LinenStockPage';
import SeasonsClosuresPage from './pages/SeasonsClosuresPage';
import OptionsResourcesPage from './pages/OptionsResourcesPage';
import PaymentsSettingsPage from './pages/PaymentsSettingsPage';
import EstablishmentClosuresPage from './pages/EstablishmentClosuresPage';
import DevisPage from './pages/DevisPage';
import AccountingPage from './pages/AccountingPage';
import PlatformAccountsPage from './pages/PlatformAccountsPage';
import EmailTemplatesPage from './pages/EmailTemplatesPage';
import EmailHistoryPage from './pages/EmailHistoryPage';
import ScrollToTop from './components/ScrollToTop';
import UpdateProgressOverlay from './components/UpdateProgressOverlay';
import AppVersionBadge from './components/AppVersionBadge';
import RouteErrorBoundary from './components/ErrorBoundary';
import EmptyState from './components/EmptyState';
import SearchOffIcon from '@mui/icons-material/SearchOff';

const DRAWER_WIDTH = 240;

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
// and the children's order matters for display.
const CALENDAR_CHILDREN  = ['/calendar', '/resource-planning'];
const EMAILS_CHILDREN    = ['/emails', '/emails/historique'];
const FINANCE_CHILDREN   = ['/finance', '/finance/tourist-tax', '/comptabilite', '/comptabilite/plateformes'];
const SETTINGS_CHILDREN  = ['/settings', ...SETTINGS_PATHS];

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
  const showFinance  = canAnyOf(FINANCE_CHILDREN);
  const showSettings = canAnyOf(SETTINGS_CHILDREN);

  const [properties, setProperties] = useState([]);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const [emailsMenuOpen, setEmailsMenuOpen] = useState(false);
  const [financeMenuOpen, setFinanceMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [settingsPropertiesMenuOpen, setSettingsPropertiesMenuOpen] = useState(false);
  const selectedCalendarPropertyId = new URLSearchParams(location.search).get('propertyId');

  useEffect(() => {
    let isMounted = true;
    api.getProperties()
      .then((items) => {
        if (isMounted) setProperties(items || []);
      })
      .catch(() => {
        if (isMounted) setProperties([]);
      });
    return () => {
      isMounted = false;
    };
  }, [location.pathname, location.search]);

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
    if (location.pathname === '/resource-planning') {
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
    if (location.pathname.startsWith('/finance') || location.pathname.startsWith('/comptabilite')) {
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
            <ListItemButton
              {...linkProps}
              onClick={(e) => {
                if (item.path === '/calendar') {
                  setCalendarMenuOpen((location.pathname.startsWith('/calendar') || location.pathname === '/resource-planning') ? true : (prev) => !prev);
                  setEmailsMenuOpen(false);
                  setFinanceMenuOpen(false);
                  setSettingsMenuOpen(false);
                } else if (item.path === '/emails') {
                  setEmailsMenuOpen(location.pathname.startsWith('/emails') ? true : (prev) => !prev);
                  setCalendarMenuOpen(false);
                  setFinanceMenuOpen(false);
                  setSettingsMenuOpen(false);
                } else if (item.path === '/finance') {
                  setFinanceMenuOpen((location.pathname.startsWith('/finance') || location.pathname.startsWith('/comptabilite')) ? true : (prev) => !prev);
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
                    ? (location.pathname.startsWith('/finance') || location.pathname.startsWith('/comptabilite'))
                    : item.path === '/settings'
                      ? isSettingsPath(location.pathname)
                      : location.pathname === item.path
              }
              sx={{ mx: 1, borderRadius: 2, mb: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
              {item.path === '/calendar' && (
                <Box
                  component="span"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCalendarMenuOpen((prev) => !prev);
                  }}
                  sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
                >
                  {calendarMenuOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </Box>
              )}
              {item.path === '/emails' && (
                <Box
                  component="span"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEmailsMenuOpen((prev) => !prev);
                  }}
                  sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
                >
                  {emailsMenuOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </Box>
              )}
              {item.path === '/finance' && (
                <Box
                  component="span"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setFinanceMenuOpen((prev) => !prev);
                  }}
                  sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
                >
                  {financeMenuOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </Box>
              )}
              {item.path === '/settings' && (
                <Box
                  component="span"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSettingsMenuOpen((prev) => !prev);
                  }}
                  sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
                >
                  {settingsMenuOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </Box>
              )}
            </ListItemButton>
            {item.path === '/calendar' && (
              <Collapse in={calendarMenuOpen} timeout="auto" unmountOnExit>
                <List disablePadding sx={{ px: 1, pb: 0.5 }}>
                  {can('/resource-planning') && (
                  <ListItemButton
                    component={Link}
                    to="/resource-planning"
                    onClick={(e) => onItemClick && onItemClick(e, '/resource-planning')}
                    selected={location.pathname === '/resource-planning'}
                    sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                  >
                    <ListItemText
                      primary="Ressources"
                      slotProps={{
                        primary: { variant: 'body2', fontStyle: 'italic' }
                      }}
                    />
                  </ListItemButton>
                  )}
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
                          primary: {
                            variant: 'body2',
                            noWrap: true,
                          }
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
                      primary: { variant: 'body2', noWrap: true }
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
                      primary: { variant: 'body2', noWrap: true }
                    }} />
                  </ListItemButton>
                  )}
                </List>
              </Collapse>
            )}
            {item.path === '/finance' && (
              <Collapse in={financeMenuOpen} timeout="auto" unmountOnExit>
                <List disablePadding sx={{ px: 1, pb: 0.5 }}>
                  {can('/finance') && (
                  <ListItemButton
                    component={Link}
                    to="/finance"
                    onClick={(e) => onItemClick && onItemClick(e, '/finance')}
                    selected={location.pathname === '/finance'}
                    sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                  >
                    <ListItemText primary="Vue générale" slotProps={{
                      primary: { variant: 'body2', noWrap: true }
                    }} />
                  </ListItemButton>
                  )}
                  {can('/finance/tourist-tax') && (
                  <ListItemButton
                    component={Link}
                    to="/finance/tourist-tax"
                    onClick={(e) => onItemClick && onItemClick(e, '/finance/tourist-tax')}
                    selected={location.pathname === '/finance/tourist-tax'}
                    sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                  >
                    <ListItemText primary="Taxe de séjour" slotProps={{
                      primary: { variant: 'body2', noWrap: true }
                    }} />
                  </ListItemButton>
                  )}
                  {can('/comptabilite') && (
                  <ListItemButton
                    component={Link}
                    to="/comptabilite"
                    onClick={(e) => onItemClick && onItemClick(e, '/comptabilite')}
                    selected={location.pathname === '/comptabilite'}
                    sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                  >
                    <ListItemText primary="Comptabilité" slotProps={{
                      primary: { variant: 'body2', noWrap: true }
                    }} />
                  </ListItemButton>
                  )}
                  {can('/comptabilite/plateformes') && (
                  <ListItemButton
                    component={Link}
                    to="/comptabilite/plateformes"
                    onClick={(e) => onItemClick && onItemClick(e, '/comptabilite/plateformes')}
                    selected={location.pathname === '/comptabilite/plateformes'}
                    sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                  >
                    <ListItemText primary="Plan comptable" slotProps={{
                      primary: { variant: 'body2', noWrap: true }
                    }} />
                  </ListItemButton>
                  )}
                </List>
              </Collapse>
            )}
            {item.path === '/settings' && (
              <Collapse in={settingsMenuOpen} timeout="auto" unmountOnExit>
                <List disablePadding sx={{ px: 1, pb: 0.5 }}>
                  {/* specs/settings-rationalization.md rules 1-2 — entries by family, a thin divider
                      between families; the list lives in constants/settingsMenu.js. */}
                  {SETTINGS_MENU.map((entry, index) => {
                    if (!entry) return <Divider key={`settings-divider-${index}`} sx={{ mx: 2, my: 0.5 }} />;
                    if (!can(entry.path)) return null;
                    const isProperties = entry.path === PROPERTIES_PATH;
                    return (
                      <Box key={entry.path}>
                        <ListItemButton
                          component={Link}
                          to={entry.path}
                          onClick={(e) => {
                            if (isProperties) setSettingsPropertiesMenuOpen((prev) => !prev);
                            if (onItemClick) onItemClick(e, entry.path);
                          }}
                          selected={isEntrySelected(entry, location.pathname)}
                          sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                        >
                          <ListItemIcon sx={{ minWidth: 34 }}><entry.Icon fontSize="small" /></ListItemIcon>
                          <ListItemText primary={entry.label} slotProps={{
                            primary: { variant: 'body2', noWrap: true }
                          }} />
                          {isProperties && (
                            <Box
                              component="span"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSettingsPropertiesMenuOpen((prev) => !prev);
                              }}
                              sx={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}
                            >
                              {settingsPropertiesMenuOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                            </Box>
                          )}
                        </ListItemButton>
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
                                    slotProps={{ primary: { variant: 'body2', noWrap: true } }}
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

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  // Global reservation search lives in the top bar (specs/reservation-number-and-search.md §6).
  // On mobile it collapses behind a magnifier that expands into a full-width field.
  const [searchOpen, setSearchOpen] = useState(false);
  const handleHeaderSearchSelect = (id) => {
    setSearchOpen(false);
    navigate(withFrom(`/reservations/${id}`, `${location.pathname}${location.search}`));
  };

  // Push the configured company logo into the document's <link rel="icon"> at runtime. Server-side
  // middleware also serves the logo on /favicon.ico in prod, but the CRA dev server :3000 serves
  // public/favicon.ico directly without proxying — this hook covers both modes + sidesteps the
  // browser's aggressive favicon cache via a version-keyed buster.
  useDynamicFavicon({ refreshKey: user && user.id });

  // Non-admin roles are confined client-side to their allowed surface (the server already 403s every
  // other endpoint, but we redirect so they don't see empty shells). A user who also holds admin
  // keeps the full app. Combined non-admin roles get the union of their allowed paths.
  // - Accountant → /comptabilite* + /mon-compte (specs/admin-account-management.md).
  // - Reception  → / + /planning + /mon-compte (specs/reception-role-checkin-only.md).
  useEffect(() => {
    if (!user || userHasRole(user, ADMIN)) return;
    const isAccountant = userHasRole(user, ACCOUNTANT);
    const isReception = userHasRole(user, RECEPTION);
    if (!isAccountant && !isReception) return;
    const path = location.pathname;
    const own = path === '/mon-compte' || path === '/account';
    const allowed = (isAccountant && (path.startsWith('/comptabilite') || own))
      || (isReception && (path === '/' || path === '/planning' || own));
    if (allowed) return;
    navigate(isReception ? '/' : '/comptabilite', { replace: true });
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
        <Toolbar sx={{ gap: 1 }}>
          {isMobile && (
            <IconButton edge="start" onClick={() => setMobileOpen(!mobileOpen)} sx={{ mr: 0.5 }}>
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
              {/* Wordmark in the « Maison » serif (specs/ds-sweep-planning.md rule 25) — same face
                  as the page titles, keeps the primary green and the h6 size. */}
              <Typography variant="h6" sx={{ fontFamily: (t) => t.typography.pageTitle.fontFamily, fontWeight: 700, color: 'primary.main' }}>
                GuestFlow
              </Typography>
              {!isMobile && (
                // Desktop: the search field is always visible next to the logo.
                <Box sx={{ ml: 3, flexGrow: 1, maxWidth: 440 }}>
                  <ReservationSearchBox onSelect={handleHeaderSearchSelect} />
                </Box>
              )}
              <Box sx={{ flexGrow: 1 }} />
              {isMobile && (
                <IconButton onClick={() => setSearchOpen(true)} aria-label="Rechercher une réservation">
                  <SearchIcon />
                </IconButton>
              )}
              {/* Version installée + point d'entrée mise à jour (specs/self-update-and-releases.md §6.5). */}
              <AppVersionBadge />
            </>
          )}
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
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, px: { xs: 1.5, sm: 2, md: 3 }, py: { xs: 2, md: 3 }, mt: 8, bgcolor: 'background.default', minHeight: '100vh' }}>
        {/* Anti-lockout safety net — persistent until the operator has logged in once with the new
            address. See specs/admin-account-management.md follow-up #7 (2026-06-02). */}
        <EmailVerifyBanner />
        {/* Self-update progress (specs/self-update-and-releases.md §6.3). Mounted at app level so it
            takes over wherever the update was triggered from, and survives a reload mid-update. */}
        <UpdateProgressOverlay />
        {/* Render-crash guard + catch-all 404 (specs/ds-components.md §3.4) — a component throw or
            an unknown URL used to leave the main area blank. */}
        <RouteErrorBoundary>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/properties" element={<PropertiesPage />} />
          <Route path="/properties/:id" element={<PropertyDetail />} />
          <Route path="/properties/:id/pricing-seasons" element={<PropertyPricingSeasonsPage />} />
          <Route path="/parametres/recettes" element={<TariffRecipesPage />} />
          <Route path="/options" element={<OptionsPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/reservations/new" element={<ReservationPage />} />
          <Route path="/reservations/:reservationId" element={<ReservationPage />} />
          <Route path="/reservations/upcoming" element={<ReservationsUpcomingPage />} />
          <Route path="/devis" element={<DevisPage />} />
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/finance/tourist-tax" element={<TouristTaxPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/resource-planning" element={<ResourcePlanningPage />} />
          <Route path="/school-holidays" element={<SchoolHolidaysPage />} />
          <Route path="/establishment-closures" element={<EstablishmentClosuresPage />} />
          {/* Paramètres (specs/settings-rationalization.md rule 2). */}
          <Route path="/settings" element={<Navigate to="/settings/etablissement" replace />} />
          <Route path="/settings/etablissement" element={<EstablishmentSettingsPage />} />
          <Route path="/settings/plateformes" element={<PlatformsSettingsPage />} />
          <Route path="/settings/tva-exercice" element={<VatFiscalSettingsPage />} />
          <Route path="/settings/emails" element={<EmailSettingsPage />} />
          <Route path="/settings/integrations" element={<IntegrationsSettingsPage />} />
          <Route path="/settings/systeme" element={<SystemSettingsPage />} />
          <Route path="/settings/utilisateurs" element={<UserManagementPage />} />
          <Route path="/parametres/stock-blanchisserie" element={<LinenStockPage />} />
          <Route path="/parametres/tarifs" element={<Navigate to="/parametres/options-ressources?tab=sas" replace />} />
          <Route path="/parametres/vacances-fermetures" element={<SeasonsClosuresPage />} />
          <Route path="/parametres/options-ressources" element={<OptionsResourcesPage />} />
          <Route path="/parametres/paiements" element={<PaymentsSettingsPage />} />
          {/* « Mon compte » — every role (rule 6). Legacy paths redirect to it. */}
          <Route path="/mon-compte" element={<AccountPage />} />
          <Route path="/settings/password" element={<Navigate to="/mon-compte" replace />} />
          <Route path="/comptes" element={<Navigate to="/mon-compte" replace />} />
          <Route path="/account" element={<Navigate to="/mon-compte" replace />} />
          <Route path="/comptabilite" element={<AccountingPage />} />
          <Route path="/comptabilite/plateformes" element={<PlatformAccountsPage />} />
          <Route path="/emails"            element={<EmailTemplatesPage />} />
          <Route path="/emails/modeles"    element={<Navigate to="/emails" replace />} />
          <Route path="/emails/historique" element={<EmailHistoryPage />} />
          <Route path="*" element={<NotFoundRoute />} />
        </Routes>
        </RouteErrorBoundary>
      </Box>
    </Box>
  );
}

// Catch-all 404 (specs/ds-components.md §3.4) — no role gate: any signed-in user can land here.
function NotFoundRoute() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={<SearchOffIcon />}
      title="Page introuvable"
      message="Cette adresse ne correspond à aucune page de GuestFlow."
      actionLabel="Retour au tableau de bord"
      onAction={() => navigate('/')}
      py={10}
    />
  );
}

function ForcedPasswordChange() {
  const { changePassword } = useAuth();
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 440 }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="pageTitle" component="h1" sx={{ color: 'primary.main', mb: 1 }}>Définir votre mot de passe</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Vous utilisez le mot de passe par défaut. Choisissez-en un nouveau pour accéder à l'application.
          </Typography>
          <ChangePasswordForm
            currentLabel="Mot de passe actuel (par défaut)"
            submitLabel="Définir le mot de passe"
            onSubmit={changePassword}
          />
        </CardContent>
      </Card>
    </Box>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!user) return <LoginPage />;
  if (user.mustChangePassword) return <ForcedPasswordChange />;
  return <AppShell />;
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
