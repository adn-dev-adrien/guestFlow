/**
 * AccountPage — « Mon compte » at `/mon-compte`, reachable by every role from the bottom of the
 * sidebar (specs/settings-rationalization.md rule 6). Split out of the former « Gestion
 * utilisateur » page, which now holds only the admin user table (Paramètres → Utilisateurs).
 *
 * Two sections:
 *   - « Mes informations » — the user edits their own identity (PUT /api/users/me; roles are never
 *     writable there — the server ignores them).
 *     A changed email first asks the password (and the current code of a second step) in a
 *     ReauthDialog (specs/hosting-h2-account-security.md rule 59).
 *   - « Mon mot de passe » — ChangePasswordForm. On a forced first-login change the server destroys
 *     the session and the page redirects to /login?reason=password-changed.
 *   - « Validation en deux étapes » — TwoFactorSection (specs/hosting-h2-account-security.md rules 6, 38–53);
 *     `?activer=deux-etapes` opens its activation (rule 51) and is removed from the address.
 *
 * A support session borrows an account it must not touch: neither password nor second step
 * (rule 15).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Alert, Box, Card, CardContent, Stack, Typography } from '@mui/material';
import api from '../api';
import PageActionBar from '../components/PageActionBar';
import { useToast } from '../components/DialogProvider';
import ChangePasswordForm from '../components/ChangePasswordForm';
import ReauthDialog from '../components/ReauthDialog';
import SelfProfileSection from '../components/SelfProfileSection';
import TwoFactorSection from '../components/TwoFactorSection';
import { useAuth } from '../hooks/useAuth';

export default function AccountPage() {
  const { user: me, changePassword, refresh: refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const wantsActivation = searchParams.get('activer') === 'deux-etapes';
  const activationHandled = useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams]);
  const { showSuccess, showError } = useToast();
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileErrors, setProfileErrors] = useState({});
  const [emailStatus, setEmailStatus] = useState(null);
  const [emailChange, setEmailChange] = useState(null);

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

  const saveProfile = useCallback(async (payload) => {
    setProfileBusy(true);
    setProfileErrors({});
    try {
      await api.updateSelf(payload);
      if (typeof refreshAuth === 'function') await refreshAuth();
      await refreshEmailStatus();
      showSuccess('Informations mises à jour.');
    } catch (err) {
      if (err && err.field) {
        const friendly = err.error === 'INVALID_EMAIL' ? 'Adresse email invalide.'
          : err.error === 'EMAIL_ALREADY_EXISTS' ? 'Cette adresse est déjà utilisée par un autre compte.'
            : (err.detail || err.error);
        setProfileErrors({ [err.field]: friendly });
        return true;
      }
      if (payload.currentPassword !== undefined) throw err;
      showError((err && (err.detail || err.message || err.error)) || 'Mise à jour impossible.');
    } finally {
      setProfileBusy(false);
    }
  }, [refreshAuth, refreshEmailStatus, showSuccess, showError]);

  const handleProfileSubmit = useCallback(async (payload) => {
    const changed = String(payload.email || '').trim().toLowerCase() !== String((me && me.email) || '').toLowerCase();
    if (!changed) {
      await saveProfile(payload);
      return;
    }
    let status = null;
    try {
      status = await api.getTwoFactorStatus();
    } catch {
      status = null;
    }
    setEmailChange({ payload, needsCode: Boolean(status && status.reauthNeedsCode), byEmail: Boolean(status && status.method === 'email') });
  }, [me, saveProfile]);

  const confirmEmailChange = useCallback(async ({ password, code }) => {
    await saveProfile({ ...emailChange.payload, currentPassword: password, code });
    setEmailChange(null);
  }, [emailChange, saveProfile]);

  const subtitle = useMemo(() => (
    me && me.email ? <Typography variant="caption" color="text.disabled">{me.email}</Typography> : null
  ), [me]);

  return (
    <Box>
      <PageActionBar title="Mon compte" subtitle={subtitle} />
      <Box sx={{ maxWidth: 880, mx: 'auto', p: { xs: 1.5, sm: 3 } }}>
        <SelfProfileSection
          initialValues={me}
          emailStatus={emailStatus}
          fieldErrors={profileErrors}
          busy={profileBusy}
          onSubmit={handleProfileSubmit}
        />
        <ReauthDialog
          open={Boolean(emailChange)}
          onClose={() => setEmailChange(null)}
          title="Changer l’adresse email"
          text="Mot de passe demandé : cette adresse sert à la connexion."
          submitLabel="Confirmer"
          needsCode={Boolean(emailChange && emailChange.needsCode)}
          onSendCode={emailChange && emailChange.byEmail ? () => api.sendTwoFactorActionCode() : undefined}
          onSubmit={confirmEmailChange}
        />
        {!(me && me.isSupport) && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack spacing={2}>
              <Box>
                <Typography variant="sectionHeader">Mon mot de passe</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Choisissez un nouveau mot de passe d'au moins 10 caractères.
                  {wasMustChange && (
                    <>{' '}Reconnexion ensuite avec le nouveau mot de passe.</>
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
        )}
        {me && !me.isSupport && !wasMustChange && <TwoFactorSection account={me.email} startOpen={wantsActivation} onStartHandled={activationHandled} notify={showSuccess} />}
      </Box>
    </Box>
  );
}
