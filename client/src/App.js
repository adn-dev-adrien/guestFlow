import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import {
  AppBar, Toolbar, Typography, Drawer, List, ListItemButton, ListItemIcon,
  ListItemText, Box, IconButton, useMediaQuery, Collapse
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import EventIcon from '@mui/icons-material/Event';
import ExtensionIcon from '@mui/icons-material/Extension';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import DateRangeIcon from '@mui/icons-material/DateRange';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
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
import FinancePage from './pages/FinancePage';
import TouristTaxPage from './pages/TouristTaxPage';
import SchoolHolidaysPage from './pages/SchoolHolidaysPage';
import ResourcesPage from './pages/ResourcesPage';
import PlanningPage from './pages/PlanningPage';

const DRAWER_WIDTH = 240;

const navItems = [
  { label: 'Tableau de bord', path: '/', icon: <DashboardIcon /> },
  { label: 'Clients', path: '/clients', icon: <PeopleIcon /> },
  { label: 'Logements', path: '/properties', icon: <HomeWorkIcon /> },
  { label: 'Options', path: '/options', icon: <ExtensionIcon /> },
  { label: 'Ressources', path: '/resources', icon: <Inventory2Icon /> },
  { label: 'Calendrier', path: '/calendar', icon: <EventIcon /> },
  { label: 'Planning', path: '/planning', icon: <CleaningServicesIcon /> },
  { label: 'Suivi financier', path: '/finance', icon: <AccountBalanceIcon /> },
  { label: 'Vacances scolaires', path: '/school-holidays', icon: <DateRangeIcon /> },
];

function NavContent({ onItemClick }) {
  const location = useLocation();
  const [properties, setProperties] = useState([]);
  const [propertiesMenuOpen, setPropertiesMenuOpen] = useState(false);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const [financeMenuOpen, setFinanceMenuOpen] = useState(false);
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
      setPropertiesMenuOpen(true);
      setCalendarMenuOpen(false);
      setFinanceMenuOpen(false);
    }
    if (location.pathname.startsWith('/calendar')) {
      setCalendarMenuOpen(true);
      setPropertiesMenuOpen(false);
      setFinanceMenuOpen(false);
    }
    if (location.pathname.startsWith('/finance')) {
      setFinanceMenuOpen(true);
      setPropertiesMenuOpen(false);
      setCalendarMenuOpen(false);
    }
  }, [location.pathname]);

  return (
    <List sx={{ pt: 2 }}>
      {navItems.map((item) => (
        <Box key={item.path}>
          <ListItemButton
            component={Link}
            to={item.path}
            onClick={(e) => {
              if (item.path === '/properties') {
                setPropertiesMenuOpen((prev) => !prev);
                setCalendarMenuOpen(false);
                setFinanceMenuOpen(false);
              } else if (item.path === '/calendar') {
                setCalendarMenuOpen((prev) => !prev);
                setPropertiesMenuOpen(false);
                setFinanceMenuOpen(false);
              } else if (item.path === '/finance') {
                setFinanceMenuOpen((prev) => !prev);
                setPropertiesMenuOpen(false);
                setCalendarMenuOpen(false);
              } else {
                setPropertiesMenuOpen(false);
                setCalendarMenuOpen(false);
                setFinanceMenuOpen(false);
              }
              if (onItemClick) onItemClick(e, item.path);
            }}
            selected={
              item.path === '/properties'
                ? location.pathname.startsWith('/properties')
                : item.path === '/finance'
                  ? location.pathname.startsWith('/finance')
                  : location.pathname === item.path
            }
            sx={{ mx: 1, borderRadius: 2, mb: 0.5 }}
          >
            <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
            {item.path === '/properties' && (propertiesMenuOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />)}
            {item.path === '/calendar' && (calendarMenuOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />)}
            {item.path === '/finance' && (financeMenuOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />)}
          </ListItemButton>

          {item.path === '/properties' && (
            <Collapse in={propertiesMenuOpen} timeout="auto" unmountOnExit>
              <List disablePadding sx={{ px: 1, pb: 0.5 }}>
                {properties.map((p) => (
                  <ListItemButton
                    key={p.id}
                    component={Link}
                    to={`/properties/${p.id}`}
                    onClick={(e) => onItemClick && onItemClick(e, `/properties/${p.id}`)}
                    selected={location.pathname === `/properties/${p.id}`}
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

          {item.path === '/calendar' && (
            <Collapse in={calendarMenuOpen} timeout="auto" unmountOnExit>
              <List disablePadding sx={{ px: 1, pb: 0.5 }}>
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
                <ListItemButton
                  component={Link}
                  to="/finance"
                  onClick={(e) => onItemClick && onItemClick(e, '/finance')}
                  selected={location.pathname === '/finance'}
                  sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                >
                  <ListItemText primary="Vue générale" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                </ListItemButton>
                <ListItemButton
                  component={Link}
                  to="/finance/tourist-tax"
                  onClick={(e) => onItemClick && onItemClick(e, '/finance/tourist-tax')}
                  selected={location.pathname === '/finance/tourist-tax'}
                  sx={{ pl: 6, py: 0.75, borderRadius: 2, mb: 0.25 }}
                >
                  <ListItemText primary="Taxe de séjour" primaryTypographyProps={{ variant: 'body2', noWrap: true }} />
                </ListItemButton>
              </List>
            </Collapse>
          )}
        </Box>
      ))}
    </List>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const handleNavItemClick = (event, targetPath) => {
    if (targetPath === location.pathname) {
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
          <Route path="/finance" element={<FinancePage />} />
          <Route path="/finance/tourist-tax" element={<TouristTaxPage />} />
          <Route path="/planning" element={<PlanningPage />} />
          <Route path="/school-holidays" element={<SchoolHolidaysPage />} />
        </Routes>
      </Box>
    </Box>
  );
}

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <DialogProvider>
          <AppShell />
        </DialogProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
