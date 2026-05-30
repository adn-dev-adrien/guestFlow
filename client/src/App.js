import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import 'dayjs/locale/fr';

// Set dayjs locale globally to French
dayjs.locale('fr');

import { ThemeProvider, CssBaseline } from '@mui/material';
import {
  AppBar, Toolbar, Typography, Drawer, List, ListItemButton, ListItemIcon,
  ListItemText, Box, IconButton, useMediaQuery, Collapse,
  CircularProgress, Card, CardContent
} from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ADMIN, ACCOUNTANT, userHasRole, canSeeRoute, canSeeAnyRoute } from './constants/roles';
import LoginPage from './pages/LoginPage';
import ChangePasswordForm from './components/ChangePasswordForm';
import UserManagementPage from './pages/UserManagementPage';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import EventIcon from '@mui/icons-material/Event';
import ExtensionIcon from '@mui/icons-material/Extension';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import DateRangeIcon from '@mui/icons-material/DateRange';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import DescriptionIcon from '@mui/icons-material/Description';
import SettingsIcon from '@mui/icons-material/Settings';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import MenuIcon from '@mui/icons-material/Menu';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import theme from './theme';
import DialogProvider from './components/DialogProvider';
import api from './api';
import { PLATFORM_COLORS } from './constants/platforms';

import Dashboard from './pages/Dashboard';
import ClientsPage from './pages/ClientsPage';
import PropertiesPage from './pages/PropertiesPage';
import PropertyDetail from './pages/PropertyDetail';
import PropertyPricingSeasonsPage from './pages/PropertyPricingSeasonsPage';
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
import SettingsPage from './pages/SettingsPage';
import EstablishmentClosuresPage from './pages/EstablishmentClosuresPage';
import DevisPage from './pages/DevisPage';
import AccountingPage from './pages/AccountingPage';

const DRAWER_WIDTH = 240;

const navItems = [
  { label: 'Tableau de bord', path: '/', icon: <DashboardIcon /> },
  { label: 'Planning', path: '/planning', icon: <CleaningServicesIcon /> },
  { label: 'Calendrier', path: '/calendar', icon: <EventIcon /> },
  { label: 'Suivi financier', path: '/finance', icon: <AccountBalanceIcon /> },
  { label: 'Devis', path: '/devis', icon: <DescriptionIcon /> },
  { label: 'Parametres', path: '/settings', icon: <SettingsIcon /> },
];

// Children-of-each-parent map — keeps the parent visibility decision in one place. Hard-coded
// (matches the JSX below) instead of derived from ROUTE_ROLES because the JSX itself is hand-rolled
// and the children's order matters for display.
const CALENDAR_CHILDREN  = ['/calendar', '/resource-planning'];
const FINANCE_CHILDREN   = ['/finance', '/finance/tourist-tax', '/comptabilite'];
const SETTINGS_CHILDREN  = ['/settings', '/properties', '/options', '/resources', '/clients', '/school-holidays', '/establishment-closures', '/account'];

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
      setFinanceMenuOpen(false);
      setSettingsMenuOpen(true);
      setSettingsPropertiesMenuOpen(true);
    }
    if (location.pathname.startsWith('/calendar')) {
      setCalendarMenuOpen(true);
      setFinanceMenuOpen(false);
      setSettingsMenuOpen(false);
      setSettingsPropertiesMenuOpen(false);
    }
    if (location.pathname === '/resource-planning') {
      setCalendarMenuOpen(true);
      setFinanceMenuOpen(false);
      setSettingsMenuOpen(false);
      setSettingsPropertiesMenuOpen(false);
    }
    if (location.pathname.startsWith('/finance') || location.pathname === '/comptabilite') {
      setFinanceMenuOpen(true);
      setCalendarMenuOpen(false);
      setSettingsMenuOpen(false);
      setSettingsPropertiesMenuOpen(false);
    }
    if (
      location.pathname === '/settings'
      || location.pathname === '/options'
      || location.pathname === '/resources'
      || location.pathname === '/clients'
      || location.pathname === '/school-holidays'
      || location.pathname === '/establishment-closures'
      || location.pathname === '/account'
    ) {
      setSettingsMenuOpen(true);
      setCalendarMenuOpen(false);
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
        const isSubmenuParent = item.path === '/calendar' || item.path === '/finance' || item.path === '/settings';
        const linkProps = isParentReachable ? { component: Link, to: item.path } : {};
        return (
        <Box key={item.path}>
          <ListItemButton
            {...linkProps}
            onClick={(e) => {
              if (item.path === '/calendar') {
                setCalendarMenuOpen((location.pathname.startsWith('/calendar') || location.pathname === '/resource-planning') ? true : (prev) => !prev);
                setFinanceMenuOpen(false);
                setSettingsMenuOpen(false);
              } else if (item.path === '/finance') {
                setFinanceMenuOpen((location.pathname.startsWith('/finance') || location.pathname === '/comptabilite') ? true : (prev) => !prev);
                setCalendarMenuOpen(false);
                setSettingsMenuOpen(false);
              } else if (item.path === '/settings') {
                setSettingsMenuOpen(
                  location.pathname === '/settings'
                                  || location.pathname === '/options'
                    || location.pathname === '/resources'
                    || location.pathname === '/clients'
                    || location.pathname === '/school-holidays'
                    || location.pathname === '/establishment-closures'
                    || location.pathname === '/account'
                    || location.pathname.startsWith('/properties')
                    ? true
                    : (prev) => !prev
                );
                setCalendarMenuOpen(false);
                setFinanceMenuOpen(false);
                setSettingsPropertiesMenuOpen(location.pathname.startsWith('/properties'));
              } else {
                setCalendarMenuOpen(false);
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
                : item.path === '/finance'
                  ? (location.pathname.startsWith('/finance') || location.pathname === '/comptabilite')
                  : item.path === '/settings'
                    ? (
                      location.pathname === '/settings'
                                      || location.pathname === '/options'
                      || location.pathname === '/resources'
                      || location.pathname === '/clients'
                      || location.pathname === '/school-holidays'
                      || location.pathname === '/establishment-closures'
                      || location.pathname === '/account'
                      || location.pathname.startsWith('/properties')
                    )
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
                    primaryTypographyProps={{ variant: 'body2', fontStyle: 'italic' }}
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
                      primaryTypographyProps={{
                        variant: 'body2',
                        noWrap: true,
                      }}
                    />
                  </ListItemButton>
                ))}
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
                  <ListItemText primary="Vue générale" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
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
                  <ListItemText primary="Taxe de séjour" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
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
                  <ListItemText primary="Comptabilité" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                </ListItemButton>
                )}
              </List>
            </Collapse>
          )}

          {item.path === '/settings' && (
            <Collapse in={settingsMenuOpen} timeout="auto" unmountOnExit>
              <List disablePadding sx={{ px: 1, pb: 0.5 }}>
                {can('/settings') && (
                <ListItemButton
                  component={Link}
                  to="/settings"
                  onClick={(e) => onItemClick && onItemClick(e, '/settings')}
                  selected={location.pathname === '/settings'}
                  sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}><SettingsIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Générale" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                </ListItemButton>
                )}
                {can('/properties') && (
                <ListItemButton
                  component={Link}
                  to="/properties"
                  onClick={(e) => {
                    setSettingsPropertiesMenuOpen((prev) => !prev);
                    if (onItemClick) onItemClick(e, '/properties');
                  }}
                  selected={location.pathname.startsWith('/properties')}
                  sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}><HomeWorkIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Logements" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
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
                </ListItemButton>
                )}
                {can('/properties') && (
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
                          primaryTypographyProps={{
                            variant: 'body2',
                            noWrap: true,
                          }}
                        />
                      </ListItemButton>
                    ))}
                  </List>
                </Collapse>
                )}
                {can('/options') && (
                <ListItemButton
                  component={Link}
                  to="/options"
                  onClick={(e) => onItemClick && onItemClick(e, '/options')}
                  selected={location.pathname === '/options'}
                  sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}><ExtensionIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Options" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                </ListItemButton>
                )}
                {can('/resources') && (
                <ListItemButton
                  component={Link}
                  to="/resources"
                  onClick={(e) => onItemClick && onItemClick(e, '/resources')}
                  selected={location.pathname === '/resources'}
                  sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}><Inventory2Icon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Ressources" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                </ListItemButton>
                )}
                {can('/clients') && (
                <ListItemButton
                  component={Link}
                  to="/clients"
                  onClick={(e) => onItemClick && onItemClick(e, '/clients')}
                  selected={location.pathname === '/clients'}
                  sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}><PeopleIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Clients" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                </ListItemButton>
                )}
                {can('/school-holidays') && (
                <ListItemButton
                  component={Link}
                  to="/school-holidays"
                  onClick={(e) => onItemClick && onItemClick(e, '/school-holidays')}
                  selected={location.pathname === '/school-holidays'}
                  sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}><DateRangeIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Vacances scolaires" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                </ListItemButton>
                )}
                {can('/establishment-closures') && (
                <ListItemButton
                  component={Link}
                  to="/establishment-closures"
                  onClick={(e) => onItemClick && onItemClick(e, '/establishment-closures')}
                  selected={location.pathname === '/establishment-closures'}
                  sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}><EventBusyIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Fermetures" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                </ListItemButton>
                )}
                {can('/account') && (
                <ListItemButton
                  component={Link}
                  to="/account"
                  onClick={(e) => onItemClick && onItemClick(e, '/account')}
                  selected={location.pathname === '/account'}
                  sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}><AdminPanelSettingsIcon fontSize="small" /></ListItemIcon>
                  <ListItemText primary="Gestion utilisateur" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                </ListItemButton>
                )}
              </List>
            </Collapse>
          )}
        </Box>
        );
      })}
      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
        <ListItemButton onClick={() => logout()} sx={{ py: 0.75, borderRadius: 2, mx: 1 }}>
          <ListItemIcon sx={{ minWidth: 34 }}><LogoutIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Se déconnecter" primaryTypographyProps={{ variant: 'body2' }} />
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
  const [versionInfo, setVersionInfo] = useState(null);

  // Accountants are confined to /comptabilite and /account (the server already 403s every other
  // endpoint, but we redirect at the client so they don't see empty shells). Multi-role users who
  // also hold admin keep the full app.
  useEffect(() => {
    if (!user || !userHasRole(user, ACCOUNTANT) || userHasRole(user, ADMIN)) return;
    const allowed = location.pathname === '/comptabilite' || location.pathname === '/account';
    if (!allowed) navigate('/comptabilite', { replace: true });
  }, [user, location.pathname, navigate]);

  useEffect(() => {
    let isMounted = true;
    api.getSettings()
      .then((settings) => {
        if (!isMounted) return;
        if (settings?.companyLogoPath) {
          // Replace the default favicon (favicon.ico + favicon.svg from index.html) with the company
          // logo. Remove the defaults first so an SVG-capable browser doesn't keep preferring favicon.svg.
          document.querySelectorAll("link[rel~='icon']").forEach((el) => el.remove());
          const link = document.createElement('link');
          link.rel = 'icon';
          link.href = settings.companyLogoPath;
          document.head.appendChild(link);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    api.getPlatformColors()
      .then((data) => {
        if (!isMounted) return;
        const customColors = data?.customColors || {};
        Object.assign(PLATFORM_COLORS, customColors);
      })
      .catch(() => {
        // Keep static colors when custom colors cannot be loaded.
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return undefined;
    let isMounted = true;
    api.getVersion()
      .then((data) => {
        if (!isMounted) return;
        setVersionInfo(data || null);
      })
      .catch(() => {
        if (!isMounted) return;
        setVersionInfo(null);
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
      <AppBar position="fixed" elevation={0} sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: 'white', color: 'text.primary', borderBottom: '1px solid #e0e0e0' }}>
        <Toolbar>
          {isMobile && (
            <IconButton edge="start" onClick={() => setMobileOpen(!mobileOpen)} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
            GuestFlow
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          {process.env.NODE_ENV === 'production' && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
              {versionInfo?.commitShaShort ? `prod ${versionInfo.commitShaShort}` : 'prod'}
            </Typography>
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

      <Box component="main" sx={{ flexGrow: 1, px: { xs: 1.5, sm: 2, md: 3 }, py: { xs: 2, md: 3 }, mt: 8, bgcolor: 'background.default', minHeight: '100vh' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/properties" element={<PropertiesPage />} />
          <Route path="/properties/:id" element={<PropertyDetail />} />
          <Route path="/properties/:id/pricing-seasons" element={<PropertyPricingSeasonsPage />} />
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
          <Route path="/settings" element={<SettingsPage />} />
          {/* Legacy paths redirect to the unified "Gestion utilisateur" page. */}
          <Route path="/settings/password" element={<Navigate to="/account" replace />} />
          <Route path="/comptes" element={<Navigate to="/account" replace />} />
          <Route path="/account" element={<UserManagementPage />} />
          <Route path="/comptabilite" element={<AccountingPage />} />
        </Routes>
      </Box>
    </Box>
  );
}

function ForcedPasswordChange() {
  const { changePassword } = useAuth();
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 440 }}>
        <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main', mb: 1 }}>Définir votre mot de passe</Typography>
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
