/**
 * SupportSessionBar — the red bar « Session support — <expiry> » pinned to the bottom of every page
 * of a support session (clear of the app bar and the sticky action bars), so a screenshot is never
 * mistaken for the customer's own
 * (specs/hosting-h2-account-security.md rule 16). It also reports each page the support opens to
 * the access log (rule 15). Renders nothing outside a support session.
 */
import React, { useEffect } from 'react';
import { Box, Button } from '@mui/material';
import { useLocation } from 'react-router';
import api from '../api';
import { useAuth } from '../hooks/useAuth';

const expiryLabel = (iso) => new Date(iso).toLocaleString('fr-FR', {
  timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

export const SUPPORT_BAR_HEIGHT = 36;

export default function SupportSessionBar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const session = user && user.supportSession;

  useEffect(() => {
    if (!session) return;
    api.logSupportPage(`${location.pathname}${location.search}`).catch(() => {});
  }, [session, location.pathname, location.search]);

  if (!session) return null;
  return (
    <Box
      role="status"
      data-testid="support-session-bar"
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: (t) => t.zIndex.drawer + 2,
        minHeight: SUPPORT_BAR_HEIGHT,
        bgcolor: 'error.main',
        color: 'error.contrastText',
        fontWeight: 700,
        fontSize: 14,
        px: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
      }}
    >
      <span>{`Session support — jusqu’au ${expiryLabel(session.expiresAt)}`}</span>
      <Button size="small" color="inherit" variant="outlined" onClick={logout} sx={{ minHeight: 28, py: 0 }}>Quitter</Button>
    </Box>
  );
}
