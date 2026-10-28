/**
 * TwoFactorSection — « Validation en deux étapes » in « Mon compte » (specs/hosting-h2-account-security.md
 * rules 38–39, 46–48, 51): a status card and its actions, nothing to fill in the card itself.
 *
 * - Off: a « Désactivée » badge, one sentence and « Activer », which opens the three-step
 *   TwoFactorSetupDialog (rule 40).
 * - On: an « Activée » badge, the method and its date, the backup codes left (warning colour and
 *   « Nouveaux codes » from 3 left), « Changer d’appli » / « Nouveaux codes de secours » /
 *   « Désactiver » — each asking the password and a current code (ReauthDialog, rule 47) — and the
 *   account's history folded under « Historique (n) ».
 *
 * Everything shown, including the sentences with numbers and dates, comes from GET /api/auth/2fa/status.
 * Props: account (the user's email, written in the downloaded backup codes), startOpen (open the
 * activation as soon as the status is read, rule 51), onStartHandled().
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, Collapse, Link, Stack, Typography } from '@mui/material';
import api from '../api';
import StatusBadge from './StatusBadge';
import BackupCodesDialog from './BackupCodesDialog';
import TwoFactorSetupDialog from './TwoFactorSetupDialog';
import ReauthDialog from './ReauthDialog';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';
import { REAUTH_TEXTS, TWO_FACTOR_EXPLAINER, TWO_FACTOR_NAME } from '../constants/twoFactor';

const errorText = (err, fallback) => (err && err.message && err.message !== err.error ? err.message : fallback);

export default function TwoFactorSection({ account, startOpen = false, onStartHandled }) {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [setup, setSetup] = useState(null);
  const [reauth, setReauth] = useState(null);
  const [codes, setCodes] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      setStatus(await api.getTwoFactorStatus());
    } catch (err) {
      setLoadError(errorText(err, 'Lecture impossible.'));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!startOpen || !status) return;
    if (!status.enabled) setSetup({ enrolment: null });
    if (onStartHandled) onStartHandled();
  }, [startOpen, status, onStartHandled]);

  const toApp = status && status.method === 'email';
  const replaceKey = toApp ? 'toApp' : 'replace';

  const submitReauth = async ({ password, code }) => {
    if (reauth === 'disable') {
      setStatus(await api.disableTwoFactor(password, code));
      setReauth(null);
    } else if (reauth === 'codes') {
      const out = await api.regenerateBackupCodes(password, code);
      setStatus(out.status);
      setReauth(null);
      setCodes(out.backupCodes);
    } else {
      const enrolment = await api.startTwoFactor('totp', password, code);
      setReauth(null);
      setSetup({ enrolment });
    }
  };

  const reauthTexts = reauth && REAUTH_TEXTS[reauth === 'replace' ? replaceKey : reauth];

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="sectionHeader">{TWO_FACTOR_NAME}</Typography>
            {status && (
              <StatusBadge status={status.enabled ? 'success' : 'neutral'} label={status.enabled ? 'Activée' : 'Désactivée'} />
            )}
          </Stack>
          {loadError && <ErrorAlert message={loadError} onRetry={load} />}
          {!status && !loadError && <LoadingState />}

          {status && !status.enabled && (
            <>
              <Typography variant="body2">{TWO_FACTOR_EXPLAINER}</Typography>
              <Box>
                <Button variant="contained" onClick={() => setSetup({ enrolment: null })} sx={{ minHeight: 44 }}>Activer</Button>
              </Box>
            </>
          )}

          {status && status.enabled && (
            <>
              <Stack spacing={0.5}>
                <Typography variant="body2">{`${status.methodLabel} · ${status.enabledLabel}`}</Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="body2" color={status.backupCodesLow ? 'warning.main' : 'text.primary'} sx={status.backupCodesLow ? { fontWeight: 600 } : undefined}>
                    {status.backupCodesLow ? status.backupCodesWarning : status.backupCodesLabel}
                  </Typography>
                  {status.backupCodesLow && (
                    <Link component="button" type="button" variant="body2" onClick={() => setReauth('codes')} sx={{ minHeight: 44 }}>
                      Nouveaux codes
                    </Link>
                  )}
                </Stack>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="outlined" onClick={() => setReauth('replace')} sx={{ minHeight: 44 }}>
                  {toApp ? 'Passer à une appli' : 'Changer d’appli'}
                </Button>
                <Button variant="outlined" onClick={() => setReauth('codes')} sx={{ minHeight: 44 }}>Nouveaux codes de secours</Button>
                <Button variant="outlined" color="error" onClick={() => setReauth('disable')} sx={{ minHeight: 44 }}>Désactiver</Button>
              </Stack>
            </>
          )}

          {status && status.eventsCount > 0 && (
            <Box>
              <Link component="button" type="button" variant="body2" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}
                sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                {`Historique (${status.eventsCount})`}
              </Link>
              <Collapse in={historyOpen} unmountOnExit>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {status.events.map((e) => (
                    <Typography component="li" variant="body2" key={`${e.at}-${e.label}`}>{`${e.atLabel} — ${e.label}`}</Typography>
                  ))}
                </Box>
              </Collapse>
            </Box>
          )}
        </Stack>
      </CardContent>

      {setup && (
        <TwoFactorSetupDialog
          open
          account={account}
          emailAvailable={Boolean(status && status.emailAvailable)}
          currentMethod={status ? status.method : null}
          initialEnrolment={setup.enrolment}
          onClose={() => { setSetup(null); load(); }}
          onRestart={() => setReauth('replace')}
          onDone={(next) => { setStatus(next); setSetup(null); }}
        />
      )}
      <ReauthDialog
        open={Boolean(reauth)}
        onClose={() => setReauth(null)}
        title={reauthTexts ? reauthTexts.title : ''}
        text={reauthTexts ? reauthTexts.text : ''}
        submitLabel={reauthTexts ? reauthTexts.submitLabel : ''}
        submitColor={reauthTexts ? reauthTexts.submitColor : undefined}
        needsCode={Boolean(status && status.reauthNeedsCode)}
        onSendCode={status && status.method === 'email' ? api.sendTwoFactorActionCode : undefined}
        onSubmit={submitReauth}
      />
      <BackupCodesDialog open={Boolean(codes)} codes={codes || []} account={account} onClose={() => setCodes(null)} />
    </Card>
  );
}
