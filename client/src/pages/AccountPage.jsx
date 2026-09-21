/**
 * AccountPage — « Mon compte » at `/mon-compte`, reachable by every role from the bottom of the
 * sidebar (specs/settings-rationalization.md rule 6). Split out of the former « Gestion
 * utilisateur » page, which now holds only the admin user table (Paramètres → Utilisateurs).
 *
 * Two sections:
 *   - « Mes informations » — the user edits their own identity (PUT /api/users/me; roles are never
 *     writable there — the server ignores them).
 *   - « Mon mot de passe » — ChangePasswordForm. On a forced first-login change the server destroys
 *     the session and the page redirects to /login?reason=password-changed.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Alert, Box, Card, CardContent, Stack, Typography } from '@mui/material';
import api from '../api';
import PageActionBar from '../components/PageActionBar';
import { useToast } from '../components/DialogProvider';
import ChangePasswordForm from '../components/ChangePasswordForm';
import SelfProfileSection from '../components/SelfProfileSection';
import { useAuth } from '../hooks/useAuth';

export default function AccountPage() {
  const { user: me, changePassword, refresh: refreshAuth } = useAuth();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileErrors, setProfileErrors] = useState({});
  const [emailStatus, setEmailStatus] = useState(null);

  const wasMustChange = Boolean(me && me.mustChangePassword);
  const handlePasswordSubmit = useCallback(async (currentPassword, newPassword) => {
    await changePassword(currentPassword, newPassword, { wasMustChange });
    if (wasMustChange) navigate('/login?reason=password-changed', { replace: true });
  }, [changePassword, navigate, wasMustChange]);

  const refreshEmailStatus = useCallback(async () => {
    try {
      setEmailStatus(await api.getMyEmailStatus());
    } catch {
      // Non-blocking — the form still saves; we just can't drive the red warning.
      setEmailStatus(null);
    }
  }, []);
  useEffect(() => { refreshEmailStatus(); }, [refreshEmailStatus]);

  const handleProfileSubmit = useCallback(async (payload) => {
    setProfileBusy(true);
    setProfileErrors({});
    try {
      await api.updateSelf(payload);
      if (typeof refreshAuth === 'function') await refreshAuth();
      await refreshEmailStatus();
      showSuccess('Vos informations ont été mises à jour.');
    } catch (err) {
      if (err && err.field) {
        const friendly = err.error === 'INVALID_EMAIL' ? 'Adresse email invalide.'
          : err.error === 'EMAIL_ALREADY_EXISTS' ? 'Cette adresse est déjà utilisée par un autre compte.'
            : (err.detail || err.error);
        setProfileErrors({ [err.field]: friendly });
      } else {
        showError((err && (err.detail || err.message || err.error)) || 'Mise à jour impossible.');
      }
    } finally {
      setProfileBusy(false);
    }
  }, [refreshAuth, refreshEmailStatus, showSuccess, showError]);

  const subtitle = useMemo(() => (
    me && me.email ? <Typography variant="caption" color="text.disabled">{me.email}</Typography> : null
  ), [me]);

  return (
    <Box>
      <PageActionBar title="Mon compte" titleOnXs subtitle={subtitle} />
      <Box sx={{ maxWidth: 880, mx: 'auto', p: { xs: 1.5, sm: 3 } }}>
        <SelfProfileSection
          initialValues={me}
          emailStatus={emailStatus}
          fieldErrors={profileErrors}
          busy={profileBusy}
          onSubmit={handleProfileSubmit}
        />
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2}>
              <Box>
                <Typography variant="sectionHeader">Mon mot de passe</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Choisissez un nouveau mot de passe d'au moins 10 caractères.
                  {wasMustChange && (
                    <>{' '}Vous serez ensuite redirigé vers la page de connexion pour vous reconnecter avec votre nouveau mot de passe.</>
                  )}
                </Typography>
              </Box>
              {passwordChanged && (
                <Alert severity="success" onClose={() => setPasswordChanged(false)}>
                  Mot de passe mis à jour.
                </Alert>
              )}
              <ChangePasswordForm
                onSubmit={handlePasswordSubmit}
                onSuccess={() => { if (!wasMustChange) setPasswordChanged(true); }}
              />
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
