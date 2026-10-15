/**
 * TwoFactorSection — « Second code » in « Mon compte » (specs/hosting-h2-account-security.md
 * rules 6, 9): turn it on with an authenticator app (QR code) or a code by email, confirmed by a
 * first code; then the backup codes; turn it off or renew the backup codes with the password; and
 * the account's history (who turned it on or off).
 *
 * Everything shown comes from GET /api/auth/2fa/status. Props: account (the user's email, written in
 * the downloaded backup codes).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Stack, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import api from '../api';
import StatusBadge from './StatusBadge';
import PasswordField from './PasswordField';
import OneTimeCodeField from './OneTimeCodeField';
import BackupCodesDialog from './BackupCodesDialog';
import FormDialog from './FormDialog';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';

const errorText = (err, fallback) => (err && err.message && err.message !== err.error ? err.message : fallback);

export default function TwoFactorSection({ account }) {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [method, setMethod] = useState('totp');
  const [password, setPassword] = useState('');
  const [enrolment, setEnrolment] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null);
  const [passwordDialog, setPasswordDialog] = useState(null);
  const [dialogPassword, setDialogPassword] = useState('');
  const [dialogError, setDialogError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setStatus(await api.getTwoFactorStatus());
    } catch (err) {
      setLoadError(errorText(err, 'Lecture impossible.'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const start = async () => {
    setError('');
    setBusy(true);
    try {
      setEnrolment(await api.startTwoFactor(method, password));
      setPassword('');
      setCode('');
    } catch (err) {
      setError(errorText(err, 'Activation impossible.'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setError('');
    setBusy(true);
    try {
      const r = await api.confirmTwoFactor(code);
      setEnrolment(null);
      setStatus(r.status);
      setCodes(r.backupCodes);
    } catch (err) {
      setError(errorText(err, 'Code incorrect.'));
      if (err && err.error === 'TOO_MANY_CODES') setEnrolment(null);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const submitDialog = async () => {
    setDialogError('');
    setBusy(true);
    try {
      if (passwordDialog === 'disable') {
        setStatus(await api.disableTwoFactor(dialogPassword));
      } else {
        const r = await api.regenerateBackupCodes(dialogPassword);
        setStatus(r.status);
        setCodes(r.backupCodes);
      }
      setPasswordDialog(null);
      setDialogPassword('');
    } catch (err) {
      setDialogError(errorText(err, 'Mot de passe incorrect.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="sectionHeader">Second code</Typography>
            {status && (
              <StatusBadge status={status.enabled ? 'success' : 'neutral'} label={status.enabled ? 'Activé' : 'Désactivé'} />
            )}
          </Stack>
          {loadError && <ErrorAlert message={loadError} onRetry={load} />}
          {!status && !loadError && <LoadingState />}
          {error && <Alert severity="error">{error}</Alert>}

          {status && status.enabled && (
            <>
              <Typography variant="body2">
                {status.methodLabel} · codes de secours restants : <b>{status.backupCodesLeft}</b>
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="outlined" onClick={() => setPasswordDialog('codes')}>Nouveaux codes de secours</Button>
                <Button variant="outlined" color="error" onClick={() => setPasswordDialog('disable')}>Désactiver</Button>
              </Stack>
            </>
          )}

          {status && !status.enabled && !enrolment && (
            <>
              <ToggleButtonGroup
                exclusive
                value={method}
                onChange={(e, v) => v && setMethod(v)}
                size="small"
                sx={{ flexWrap: 'wrap' }}
              >
                <ToggleButton value="totp" sx={{ minHeight: 44 }}>Appli d’authentification</ToggleButton>
                <ToggleButton value="email" disabled={!status.emailAvailable} sx={{ minHeight: 44 }}>Code par email</ToggleButton>
              </ToggleButtonGroup>
              <PasswordField
                label="Mot de passe actuel"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                fullWidth
              />
              <Box>
                <Button variant="contained" onClick={start} disabled={busy || !password}>Activer</Button>
              </Box>
            </>
          )}

          {enrolment && (
            <>
              {enrolment.method === 'totp' ? (
                <Stack spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" color="text.secondary">Scanner ce code avec l’appli, puis saisir le code affiché.</Typography>
                  <Box component="img" src={enrolment.qrDataUrl} alt="QR code de l’appli d’authentification" sx={{ width: 220, height: 220, bgcolor: '#fff', p: 1, borderRadius: 1 }} />
                  <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, Menlo, monospace', overflowWrap: 'anywhere', textAlign: 'center' }}>
                    {enrolment.secret}
                  </Typography>
                </Stack>
              ) : (
                <Alert severity="info">{`Code envoyé à ${enrolment.sentTo}.`}</Alert>
              )}
              <OneTimeCodeField value={code} onChange={setCode} autoFocus />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="contained" onClick={confirm} disabled={busy || code.length !== 6}>Confirmer</Button>
                <Button onClick={() => { setEnrolment(null); setError(''); }}>Annuler</Button>
              </Stack>
            </>
          )}

          {status && status.events.length > 0 && (
            <Box>
              <Typography variant="overline" color="text.secondary">Journal du compte</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {status.events.map((e) => (
                  <Typography component="li" variant="body2" key={`${e.at}-${e.label}`}>{`${e.atLabel} — ${e.label}`}</Typography>
                ))}
              </Box>
            </Box>
          )}
        </Stack>
      </CardContent>

      <BackupCodesDialog open={Boolean(codes)} codes={codes || []} account={account} onClose={() => setCodes(null)} />
      <FormDialog
        open={Boolean(passwordDialog)}
        onClose={() => { setPasswordDialog(null); setDialogPassword(''); setDialogError(''); }}
        title={passwordDialog === 'disable' ? 'Désactiver le second code' : 'Nouveaux codes de secours'}
        submitLabel={passwordDialog === 'disable' ? 'Désactiver' : 'Générer'}
        submitColor={passwordDialog === 'disable' ? 'error' : undefined}
        submitDisabled={!dialogPassword}
        submitBusy={busy}
        onSubmit={submitDialog}
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          {passwordDialog === 'codes' && <Typography variant="body2">Les anciens codes ne marcheront plus.</Typography>}
          {dialogError && <Alert severity="error">{dialogError}</Alert>}
          <PasswordField
            label="Mot de passe actuel"
            value={dialogPassword}
            onChange={(e) => setDialogPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            fullWidth
          />
        </Stack>
      </FormDialog>
    </Card>
  );
}
