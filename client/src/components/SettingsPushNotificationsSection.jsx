/**
 * SettingsPushNotificationsSection — « Notifications push (cet appareil) » card
 * (specs/pwa-push-notifications.md §6).
 *
 * Self-contained (per-user data via the /push API, not the global settings form): on mount it reads the
 * device subscription state + this user's preferences. The operator enables/disables push on the current
 * device and toggles which notifications they receive (nouvelle réservation / arrivées / départs).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, CardContent, Stack, Typography, FormControlLabel, Switch, Box, Button, Alert, CircularProgress,
} from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import SendIcon from '@mui/icons-material/Send';
import api from '../api';
import { pushSupported, getPushState, enablePush, disablePush } from '../push/registerPush';

const PREF_LABELS = [
  ['newReservation', 'Nouvelle réservation'],
  ['arrivals', 'Arrivées'],
  ['departures', 'Départs'],
  // Breakfast serving-time push (specs/sas-breakfast-bread-and-push.md rule 6).
  ['breakfast', 'Petit déjeuner'],
  // Neat subscription failures (specs/neat-cancellation-insurance-subscription.md rule 11).
  ['neat', 'Souscriptions Neat'],
];

export default function SettingsPushNotificationsSection() {
  const supported = pushSupported();
  const [state, setState] = useState({ enabled: false, permission: 'default' });
  const [prefs, setPrefs] = useState({ newReservation: true, arrivals: true, departures: true, breakfast: true, neat: true });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [st, pr] = await Promise.all([
        getPushState(),
        api.getPushPreferences().catch(() => ({ newReservation: true, arrivals: true, departures: true, breakfast: true, neat: true })),
      ]);
      setState({ enabled: st.enabled, permission: st.permission });
      setPrefs(pr);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onEnable = async () => {
    setBusy(true); setError('');
    try { await enablePush(); await refresh(); }
    catch (err) { setError(err?.message || "Activation impossible."); }
    finally { setBusy(false); }
  };

  const onDisable = async () => {
    setBusy(true); setError('');
    try { await disablePush(); await refresh(); }
    finally { setBusy(false); }
  };

  const onTest = async () => {
    setTesting(true); setError(''); setNotice('');
    try {
      const r = await api.sendPushTest();
      if (r?.skipped === 'no_vapid') setError('Push non configuré côté serveur (VAPID manquant).');
      else if (r?.skipped === 'no_subscription') setError("Aucun appareil abonné. Activez d'abord les notifications.");
      else if ((r?.sent || 0) === 0) setError("Échec de l'envoi (voir les logs serveur).");
      else setNotice(`Notification envoyée à ${r.sent} appareil(s) du compte. Verrouillez l'écran ou passez en arrière-plan pour la voir.`);
    } catch (err) {
      setError(err?.message || "Échec de l'envoi du test.");
    } finally {
      setTesting(false);
    }
  };

  const onTogglePref = async (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next); // optimistic
    try { await api.updatePushPreferences({ [key]: value }); }
    catch (err) { setPrefs(prefs); setError(err?.message || "Échec de l'enregistrement."); }
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <NotificationsActiveIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              <Typography variant="sectionHeader">Notifications push (cet appareil)</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              Recevez une notification, même quand GuestFlow est fermé, sur cet appareil. Le choix des
              notifications est propre à votre compte.
            </Typography>
          </Box>

          {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
          {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}

          {!supported ? (
            <Alert severity="info">Ce navigateur ne supporte pas les notifications push.</Alert>
          ) : loading ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><CircularProgress size={18} /><Typography variant="body2" color="text.secondary">Chargement…</Typography></Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                {state.enabled ? (
                  <>
                    <Typography variant="body2" color="success.main" sx={{ fontWeight: 600 }}>Activées sur cet appareil</Typography>
                    <Button variant="outlined" color="inherit" onClick={onDisable} disabled={busy}>Désactiver</Button>
                  </>
                ) : (
                  <Button variant="contained" onClick={onEnable} disabled={busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <NotificationsActiveIcon />}>
                    Activer les notifications sur cet appareil
                  </Button>
                )}
              </Box>

              {/* Test button — same format as « Envoyer un mail de test » (SettingsSmtpSection):
                  outlined primary button + SendIcon + an explanatory caption, laid out in a column.
                  Always present in the section; disabled until push is enabled on this device. */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <Button
                  variant="outlined"
                  color="primary"
                  startIcon={testing ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
                  onClick={onTest}
                  disabled={testing || !state.enabled}
                  sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
                >
                  Envoyer une notification de test
                </Button>
                <Typography variant="caption" color="text.secondary">
                  Envoie une notification de test à vos appareils abonnés pour valider la configuration.
                </Typography>
              </Box>

              <Stack spacing={0.5}>
                {PREF_LABELS.map(([key, label]) => (
                  <FormControlLabel
                    key={key}
                    control={<Switch checked={Boolean(prefs[key])} onChange={(e) => onTogglePref(key, e.target.checked)} />}
                    label={label}
                    sx={{ alignSelf: 'flex-start' }}
                  />
                ))}
              </Stack>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
