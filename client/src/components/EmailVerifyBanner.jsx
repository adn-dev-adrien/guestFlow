/**
 * EmailVerifyBanner — persistent warning shown across every page after the operator changes their
 * login email (specs/admin-account-management.md follow-up #7, 2026-06-02).
 *
 * Without it, a typo when changing the admin email = total prod lockout on the next logout. The
 * banner stays visible until the operator has successfully logged in once with the new address.
 *
 * Driven server-side by `GET /api/users/me/email-status` → `{ mustVerifyNewEmail, emailChangedAt,
 * myEmail }`:
 *   - `mustVerifyNewEmail` is true iff `emailChangedAt` is set AND the user hasn't logged in
 *     since (`lastLoginAt <= emailChangedAt`).
 *   - Once they log out and log back in successfully, the server updates `lastLoginAt` and the
 *     flag flips to false on the next poll → banner disappears.
 *
 * Self-contained: it owns the polling (mount + when the location changes — covers profile saves)
 * and renders nothing when there's nothing to warn about, so wiring is just `<EmailVerifyBanner />`
 * in the layout.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AlertTitle, Box, Button } from '@mui/material';
import LogoutIcon from '@mui/icons-material/Logout';
import { useLocation } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../hooks/useAuth';

export default function EmailVerifyBanner() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getMyEmailStatus());
    } catch {
      // Don't surface anything — banner is a hint, not a blocker.
      setStatus(null);
    }
  }, []);

  // Refresh on mount + on every route change. The latter handles the most common flow: the user
  // changes their email on /account, the page calls refreshEmailStatus(), but every other page in
  // the app also benefits from the banner showing up immediately — the route change is a cheap
  // proxy for "something might have changed". 200 ms of overhead, runs only on navigation.
  useEffect(() => {
    if (user) refresh();
  }, [user, location.pathname, refresh]);

  if (!user || !status || !status.mustVerifyNewEmail) return null;
  const newEmail = status.myEmail || user.email || '';

  return (
    <Box sx={{ px: { xs: 1.5, sm: 2, md: 3 }, pt: { xs: 1.5, md: 2 } }}>
      <Alert
        severity="warning"
        variant="outlined"
        sx={{ borderWidth: 2 }}
        action={(
          <Button color="warning" size="small" startIcon={<LogoutIcon />} onClick={() => logout()}>
            Se déconnecter
          </Button>
        )}
      >
        <AlertTitle sx={{ fontWeight: 700 }}>
          Vérifiez votre nouvelle adresse de connexion
        </AlertTitle>
        Votre identifiant est désormais <strong>{newEmail}</strong>. Déconnectez-vous et
        reconnectez-vous au moins une fois avec cette adresse pour confirmer qu'elle fonctionne —
        ce message disparaîtra automatiquement.
      </Alert>
    </Box>
  );
}
