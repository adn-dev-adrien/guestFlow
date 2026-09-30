/**
 * The console's shell (specs/control-plane-plans-and-access.md §4.2): GuestFlow's theme and dialog
 * provider, the login until an operator is signed in (rule 31), then the navigation between the
 * fleet, the catalogue, the renewal emails, GuestFlow's own Paiements page (rule 32) and the profile.
 */
import React, { useEffect, useState } from 'react';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router';
import { AppBar, Box, Button, CssBaseline, IconButton, Toolbar, Tooltip, Typography } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import LogoutIcon from '@mui/icons-material/Logout';
import theme from '@gf/theme';
import DialogProvider, { useToast } from '@gf/components/DialogProvider';
import LoadingState from '@gf/components/LoadingState';
import LoginPage from './pages/LoginPage';
import FleetPage from './pages/FleetPage';
import NewCustomerPage from './pages/NewCustomerPage';
import CustomerPage from './pages/CustomerPage';
import CataloguePage from './pages/CataloguePage';
import ProfilePage from './pages/ProfilePage';
import EmailTemplatesPage from './pages/EmailTemplatesPage';
import PaymentsSettingsPage from '@gf/pages/PaymentsSettingsPage';
import api from './api';

const NAV = [
  { to: '/', label: 'Clients', match: (p) => p === '/' || p.startsWith('/clients') },
  { to: '/catalogue', label: 'Catalogue', match: (p) => p.startsWith('/catalogue') },
  { to: '/emails', label: 'Emails', match: (p) => p.startsWith('/emails') },
  { to: '/parametres/paiements', label: 'Réglages', match: (p) => p.startsWith('/parametres') },
  { to: '/profil', label: 'Profil', match: (p) => p.startsWith('/profil') },
];

function Shell({ operator, setOperator, notice }) {
  const { pathname } = useLocation();
  const { showSuccess } = useToast();
  useEffect(() => { if (notice) showSuccess(notice); }, [notice, showSuccess]);
  const logout = () => api.logout().finally(() => setOperator(null));

  return (
    <>
      <AppBar position="sticky" color="primary" elevation={0}>
        <Toolbar sx={{ gap: 1, px: { xs: 1, sm: 2 } }}>
          <Typography variant="h6" component="div" sx={{ fontWeight: 700, display: { xs: 'none', sm: 'block' }, mr: 2 }}>Console GuestFlow</Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flex: 1, overflowX: 'auto' }}>
            {NAV.map((n) => (
              <Button key={n.to} component={Link} to={n.to} color="inherit"
                sx={{ minHeight: 44, fontWeight: 600, opacity: n.match(pathname) ? 1 : 0.75, borderBottom: n.match(pathname) ? 2 : 0, borderRadius: 0 }}>
                {n.label}
              </Button>
            ))}
          </Box>
          <Tooltip title={`Se déconnecter (${operator.email})`}>
            <IconButton color="inherit" onClick={logout} aria-label="Se déconnecter" sx={{ width: 44, height: 44 }}><LogoutIcon /></IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Box component="main">
        <Routes>
          <Route path="/" element={<FleetPage />} />
          <Route path="/clients/nouveau" element={<NewCustomerPage />} />
          <Route path="/clients/:id" element={<CustomerPage />} />
          <Route path="/catalogue" element={<CataloguePage />} />
          <Route path="/emails" element={<EmailTemplatesPage />} />
          <Route path="/parametres/paiements" element={<PaymentsSettingsPage />} />
          <Route path="/profil" element={<ProfilePage operator={operator} onChanged={setOperator} />} />
        </Routes>
      </Box>
    </>
  );
}

export default function App() {
  const [operator, setOperator] = useState(undefined);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    api.me().then(setOperator).catch(() => setOperator(null));
    const signedOut = () => setOperator(null);
    // GuestFlow's Paiements page speaks through GuestFlow's api.js, which says `guestflow:unauthenticated`.
    const events = ['console:signed-out', 'guestflow:unauthenticated'];
    events.forEach((e) => window.addEventListener(e, signedOut));
    return () => events.forEach((e) => window.removeEventListener(e, signedOut));
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <DialogProvider>
        {operator === undefined && <LoadingState />}
        {operator === null && <LoginPage onSignedIn={(op, note) => { setNotice(note); setOperator(op); }} />}
        {operator && (
          <BrowserRouter>
            <Shell operator={operator} setOperator={setOperator} notice={notice} />
          </BrowserRouter>
        )}
      </DialogProvider>
    </ThemeProvider>
  );
}
