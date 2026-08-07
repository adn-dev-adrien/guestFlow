/**
 * SettingsGoogleCalendarSection — "Synchronisation Google Agenda" card, self-contained
 * (specs/google-calendar-oauth-rework.md §6).
 *
 * Fetches its own state from GET /api/google-calendar/status; every action is immediate
 * (OAuth redirect, calendar pick, sync-now, disconnect) — the section does NOT participate
 * in the global settings Save/Cancel anymore.
 *
 * States:
 *   1. env vars missing → info alert (GOOGLE_OAUTH_CLIENT_ID/SECRET hint), no buttons
 *   2. not connected    → explainer + « Connecter mon compte Google » (full-page redirect)
 *   3. connected        → account + calendar picker + « Synchroniser maintenant » /
 *                         « Tester la connexion » / « Déconnecter » (ConfirmDialog)
 *
 * The OAuth callback lands back on /settings?google=connected|error|invalid_state — the
 * param is toasted then cleaned from the URL (Qonto precedent on /parametres/paiements).
 *
 * Props: none.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Card, CardContent, Stack, Typography, Box, Button, Alert, Chip, CircularProgress,
  Select, MenuItem, FormControl, InputLabel,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import LoginIcon from '@mui/icons-material/Login';
import api from '../api';
import { useToast } from './DialogProvider';
import ConfirmDialog from './ConfirmDialog';
import SummaryItem from './SummaryItem';
import ErrorAlert from './ErrorAlert';

// Chip color keyed on the server's machine statusKey; the French label is rendered as-is.
const STATUS_KEY_TO_CHIP_COLOR = {
  active: 'success',
  inProgress: 'warning',
  notConfigured: 'default',
  failed: 'error',
};

export default function SettingsGoogleCalendarSection() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showSuccess, showError } = useToast();

  const [status, setStatus] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(false);
  const [calendars, setCalendars] = useState(null); // null = not loaded yet
  const [savingCalendar, setSavingCalendar] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [actionResult, setActionResult] = useState(null); // { severity, message }
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    const data = await api.getGoogleCalendarStatus();
    setStatus(data);
    setLoadError(false);
    return data;
  }, []);

  useEffect(() => {
    load().catch(() => setLoadError(true));
  }, [load]);

  // OAuth callback feedback — toast then clean the param from the URL.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const g = params.get('google');
    if (!g) return;
    if (g === 'connected') showSuccess('Compte Google connecté ✓');
    else if (g === 'invalid_state') showError('Connexion Google invalide (state). Réessayez depuis cette page.');
    else showError('Échec de la connexion Google — vérifiez les identifiants et les logs serveur.');
    params.delete('google');
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Calendar list for the picker, loaded once connected.
  useEffect(() => {
    if (!status || !status.connected || calendars !== null) return;
    api.getGoogleCalendars()
      .then((r) => setCalendars(Array.isArray(r.calendars) ? r.calendars : []))
      .catch((e) => {
        setCalendars([]);
        showError(e.message || 'Impossible de charger la liste des agendas.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handlePickCalendar = async (calendarId) => {
    setSavingCalendar(true);
    setActionResult(null);
    try {
      await api.setGoogleCalendar(calendarId);
      await load();
      showSuccess('Agenda cible enregistré — synchronisation lancée.');
    } catch (e) {
      showError(e.message || "Impossible d'enregistrer l'agenda cible.");
    } finally {
      setSavingCalendar(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setActionResult(null);
    try {
      const r = await api.googleCalendarSyncNow();
      setActionResult({
        severity: r.ok ? 'success' : 'error',
        message: r.detail ? `Synchronisation terminée : ${r.detail}.` : 'Synchronisation terminée.',
      });
      await load();
    } catch (e) {
      setActionResult({ severity: 'error', message: e.message || 'Échec de la synchronisation.' });
      load().catch(() => {});
    } finally {
      setSyncing(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setActionResult(null);
    try {
      const r = await api.testGoogleCalendarConnection();
      setActionResult({ severity: 'success', message: r.message });
    } catch (e) {
      setActionResult({ severity: 'error', message: e.message || 'Échec du test.' });
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await api.disconnectGoogleCalendar();
      setDisconnectOpen(false);
      setCalendars(null);
      setActionResult(null);
      await load();
      showSuccess('Compte Google déconnecté.');
    } catch (e) {
      showError(e.message || 'Impossible de déconnecter le compte Google.');
    } finally {
      setDisconnecting(false);
    }
  };

  const chip = status
    ? { label: status.statusLabel, color: STATUS_KEY_TO_CHIP_COLOR[status.statusKey] || 'default' }
    : null;
  const selectedCalendar = status && calendars !== null
    ? (calendars || []).find((c) => c.id === status.calendarId) || null
    : null;

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', sm: 'center' },
              gap: 1,
            }}
          >
            <Box>
              <Typography variant="sectionHeader">
                Synchronisation Google Agenda
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Vos réservations sont copiées et tenues à jour dans l'agenda Google de votre choix.
              </Typography>
            </Box>
            {chip && <Chip size="small" color={chip.color} label={chip.label} sx={{ fontWeight: 600 }} />}
          </Box>

          {loadError && (
            <ErrorAlert
              message="Impossible de charger l'état de la synchronisation Google."
              onRetry={() => { setLoadError(false); load().catch(() => setLoadError(true)); }}
            />
          )}

          {!loadError && !status && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {/* State 1 — OAuth client env vars missing. */}
          {status && !status.oauthConfigured && (
            <Alert severity="info">
              Renseignez GOOGLE_OAUTH_CLIENT_ID et GOOGLE_OAUTH_CLIENT_SECRET dans server/.env.local
              (voir le README, section Google Calendar), puis redémarrez le serveur.
            </Alert>
          )}

          {/* State 2 — configured but not connected. */}
          {status && status.oauthConfigured && !status.connected && (
            <>
              <Typography variant="body2" color="text.secondary">
                Connectez votre compte Google pour copier automatiquement vos réservations dans
                l'agenda de votre choix — y compris un agenda privé, sans aucun partage à configurer.
              </Typography>
              <Box>
                <Button
                  variant="contained"
                  startIcon={<LoginIcon />}
                  onClick={() => { window.location.href = '/api/google-calendar/oauth/authorize'; }}
                  sx={{ width: { xs: '100%', sm: 'auto' } }}
                >
                  Connecter mon compte Google
                </Button>
              </Box>
            </>
          )}

          {/* State 3 — connected. */}
          {status && status.connected && (
            <>
              <Box>
                <SummaryItem label="Compte connecté" value={status.connectedEmail} />
                <SummaryItem
                  label="Dernière synchro"
                  value={status.lastSyncLabel}
                  valuePlaceholder="Jamais synchronisé"
                />
              </Box>

              <FormControl fullWidth size="small" disabled={savingCalendar || calendars === null}>
                {/* shrink forced: with displayEmpty the renderValue text is always visible, so a
                    resting (non-shrunk) label overlaps it until the first open. */}
                <InputLabel id="google-calendar-picker-label" shrink>Agenda cible</InputLabel>
                <Select
                  labelId="google-calendar-picker-label"
                  label="Agenda cible"
                  notched
                  value={selectedCalendar ? selectedCalendar.id : ''}
                  onChange={(e) => { if (e.target.value) handlePickCalendar(e.target.value); }}
                  displayEmpty
                  renderValue={() => {
                    if (calendars === null) return 'Chargement des agendas…';
                    if (!selectedCalendar) return 'Choisir un agenda…';
                    return `${selectedCalendar.summary}${selectedCalendar.primary ? ' (principal)' : ''}`;
                  }}
                >
                  {(calendars || []).map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.summary}{c.primary ? ' (principal)' : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Box
                sx={{
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  gap: 1,
                  '& > *': { width: { xs: '100%', sm: 'auto' } },
                }}
              >
                <Button
                  variant="contained"
                  onClick={handleSyncNow}
                  disabled={!status.syncActive || syncing}
                  startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
                >
                  {syncing ? 'Synchronisation…' : 'Synchroniser maintenant'}
                </Button>
                <Button
                  variant="outlined"
                  onClick={handleTest}
                  disabled={!status.syncActive || testing}
                  startIcon={testing ? <CircularProgress size={16} color="inherit" /> : <TaskAltIcon />}
                >
                  {testing ? 'Test en cours…' : 'Tester la connexion'}
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={() => setDisconnectOpen(true)}
                  disabled={disconnecting}
                  startIcon={<LinkOffIcon />}
                >
                  Déconnecter
                </Button>
              </Box>
            </>
          )}

          {actionResult && (
            <Alert severity={actionResult.severity} onClose={() => setActionResult(null)}>
              {actionResult.message}
            </Alert>
          )}
        </Stack>
      </CardContent>

      <ConfirmDialog
        open={disconnectOpen}
        onClose={() => setDisconnectOpen(false)}
        onConfirm={handleDisconnect}
        title="Déconnecter le compte Google ?"
        message="La synchronisation sera arrêtée. Les événements déjà créés resteront dans votre agenda."
        confirmLabel="Déconnecter"
        cancelLabel="Annuler"
        confirmColor="error"
      />
    </Card>
  );
}
