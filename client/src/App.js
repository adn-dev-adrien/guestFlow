import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import {
  AppBar, Toolbar, Typography, Drawer, List, ListItemButton, ListItemIcon,
  ListItemText, Box, IconButton, useMediaQuery
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
import theme from './theme';
import DialogProvider from './components/DialogProvider';

import Dashboard from './pages/Dashboard';
import ClientsPage from './pages/ClientsPage';
import PropertiesPage from './pages/PropertiesPage';
import PropertyDetail from './pages/PropertyDetail';
import OptionsPage from './pages/OptionsPage';
import CalendarPage from './pages/CalendarPage';
import FinancePage from './pages/FinancePage';
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
  { label: 'Planning ménage', path: '/planning', icon: <CleaningServicesIcon /> },
  { label: 'Suivi financier', path: '/finance', icon: <AccountBalanceIcon /> },
  { label: 'Vacances scolaires', path: '/school-holidays', icon: <DateRangeIcon /> },
];

function NavContent() {
  const location = useLocation();
  return (
    <List sx={{ pt: 2 }}>
      {navItems.map((item) => (
        <ListItemButton
          key={item.path}
          component={Link}
          to={item.path}
          selected={location.pathname === item.path}
          sx={{ mx: 1, borderRadius: 2, mb: 0.5 }}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
          <ListItemText primary={item.label} />
        </ListItemButton>
      ))}
    </List>
  );
}

function App() {
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <DialogProvider>
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
              '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box', border: 'none', bgcolor: 'background.default' },
            }}
          >
            <Toolbar />
            <NavContent />
          </Drawer>

          <Box component="main" sx={{ flexGrow: 1, px: { xs: 1.5, sm: 2, md: 3 }, py: { xs: 2, md: 3 }, mt: 8, bgcolor: 'background.default', minHeight: '100vh' }}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/properties" element={<PropertiesPage />} />
              <Route path="/properties/:id" element={<PropertyDetail />} />
              <Route path="/options" element={<OptionsPage />} />
              <Route path="/resources" element={<ResourcesPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/finance" element={<FinancePage />} />
              <Route path="/planning" element={<PlanningPage />} />
              <Route path="/school-holidays" element={<SchoolHolidaysPage />} />
            </Routes>
          </Box>
        </Box>
        </DialogProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
