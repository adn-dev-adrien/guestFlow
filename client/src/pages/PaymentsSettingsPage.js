/**
 * PaymentsSettingsPage — dedicated "Paiements" settings page (specs/online-payments-qonto.md §3.1).
 *
 * Two sections, both server-driven:
 *   1. Qonto bank connection — status + "Connecter Qonto" (OAuth) button. The OAuth callback redirects
 *      back here with ?qonto=connected|error|invalid_state, surfaced as an alert.
 *   2. Délais & relances — every payment reminder/deadline duration, editable (nothing hard-coded).
 *
 * The provider-connection form (bank account / phone / website / description) lands in a follow-up.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Box, Card, CardContent, Typography, TextField, Button, Stack, Alert, CircularProgress,
} from '@mui/material';

import PageActionBar from '../components/PageActionBar';
import StatusCard from '../components/StatusCard';
import api from '../api';

const offsetsToText = (arr) => (Array.isArray(arr) ? arr.join(', ') : '');
const textToOffsets = (txt) => String(txt || '')
  .split(',').map((s) => s.trim()).filter((s) => s !== '')
  .map(Number).filter((n) => Number.isInteger(n));

const DAY_FIELDS = [
  'depositAbandonOffset', 'depositLinkExpiryDays',
  'balanceAbandonOffset', 'balanceLinkExpiryDays',
  'lastMinuteDays', 'fullPaymentDueDaysBefore',
];

export default function PaymentsSettingsPage() {
  const location = useLocation();
  const [qonto, setQonto] = useState(null);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const data = await api.getPaymentSettings();
    setQonto(data.qonto);
    setDraft({
      ...data.timings,
      depositReminderOffsetsText: offsetsToText(data.timings.depositReminderOffsets),
      balanceReminderOffsetsText: offsetsToText(data.timings.balanceReminderOffsets),
    });
    setDirty(false);
  }, []);

  useEffect(() => { load().catch((e) => setError(e.message || 'Erreur de chargement')); }, [load]);

  // OAuth callback feedback.
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('qonto');
    if (q === 'connected') setNotice('Qonto connecté ✓');
    else if (q === 'error') setError('Échec de la connexion Qonto — vérifie les identifiants et les logs.');
    else if (q === 'invalid_state') setError('Connexion Qonto invalide (state). Réessaie depuis cette page.');
  }, [location.search]);

  const setField = (key, value) => { setDraft((d) => ({ ...d, [key]: value })); setDirty(true); };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const payload = {
        depositReminderOffsets: textToOffsets(draft.depositReminderOffsetsText),
        balanceReminderOffsets: textToOffsets(draft.balanceReminderOffsetsText),
      };
      DAY_FIELDS.forEach((f) => { payload[f] = Number(draft[f]); });
      const res = await api.updatePaymentSettings(payload);
      setDraft((d) => ({
        ...d, ...res.timings,
        depositReminderOffsetsText: offsetsToText(res.timings.depositReminderOffsets),
        balanceReminderOffsetsText: offsetsToText(res.timings.balanceReminderOffsets),
      }));
      setDirty(false);
      setNotice('Délais enregistrés ✓');
    } catch (e) {
      setError(e.message || "Échec de l'enregistrement (vérifie les valeurs).");
    } finally {
      setSaving(false);
    }
  };

  if (!draft || !qonto) {
    return (
      <Box>
        <PageActionBar title="Paiements" backTo="/settings" />
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress /></Box>
      </Box>
    );
  }

  const connected = Boolean(qonto.connected);
  const providerEnabled = qonto.connectionStatus === 'enabled';

  return (
    <Box>
      <PageActionBar title="Paiements" backTo="/settings" onSave={handleSave} saveDisabled={!dirty} saveBusy={saving} />
      <Box sx={{ p: { xs: 1.5, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2.5, maxWidth: 900, mx: 'auto' }}>
        {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
        {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

        <StatusCard
          title="Connexion bancaire (Qonto)"
          badge={connected ? { status: 'success', label: 'Connecté' } : { status: 'warning', label: 'Non connecté' }}
          items={[
            { label: 'Mode', value: qonto.sandbox ? 'Sandbox (test)' : 'Production' },
            { label: 'Identifiants', value: qonto.configured ? 'Configurés' : 'Manquants (.env.local)' },
            { label: 'Provider de liens', value: providerEnabled ? 'Activé' : (qonto.connectionStatus || 'non connecté') },
          ]}
          actions={(
            <Button
              variant={connected ? 'outlined' : 'contained'}
              disabled={!qonto.configured}
              onClick={() => { window.location.href = '/api/payments/qonto/authorize'; }}
            >
              {connected ? 'Reconnecter Qonto' : 'Connecter Qonto'}
            </Button>
          )}
          alert={connected && !providerEnabled
            ? { severity: 'info', message: 'OAuth connecté ✓ — prochaine étape : connecter le provider de liens (formulaire à venir).' }
            : undefined}
        />

        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Délais &amp; relances</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Tout en jours. Les relances sont des décalages par rapport à la date d'échéance
              (négatif = avant, 0 = le jour J). Plusieurs relances séparées par des virgules.
            </Typography>
            <Stack spacing={2}>
              <Typography variant="subtitle2">Acompte</Typography>
              <TextField label="Relances (ex. -5, 0)" value={draft.depositReminderOffsetsText} onChange={(e) => setField('depositReminderOffsetsText', e.target.value)} fullWidth size="small" />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField type="number" label="Abandon après échéance (j)" value={draft.depositAbandonOffset} onChange={(e) => setField('depositAbandonOffset', e.target.value)} fullWidth size="small" />
                <TextField type="number" label="Expiration du lien après échéance (j)" value={draft.depositLinkExpiryDays} onChange={(e) => setField('depositLinkExpiryDays', e.target.value)} fullWidth size="small" />
              </Stack>

              <Typography variant="subtitle2" sx={{ pt: 1 }}>Solde</Typography>
              <TextField label="Relances (ex. -10, -5, 0)" value={draft.balanceReminderOffsetsText} onChange={(e) => setField('balanceReminderOffsetsText', e.target.value)} fullWidth size="small" />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField type="number" label="Abandon après échéance (j)" value={draft.balanceAbandonOffset} onChange={(e) => setField('balanceAbandonOffset', e.target.value)} fullWidth size="small" />
                <TextField type="number" label="Expiration du lien après échéance (j)" value={draft.balanceLinkExpiryDays} onChange={(e) => setField('balanceLinkExpiryDays', e.target.value)} fullWidth size="small" />
              </Stack>

              <Typography variant="subtitle2" sx={{ pt: 1 }}>Dernière minute</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField type="number" label="Seuil dernière minute (j avant arrivée)" value={draft.lastMinuteDays} onChange={(e) => setField('lastMinuteDays', e.target.value)} fullWidth size="small" />
                <TextField type="number" label="Échéance paiement total (j avant arrivée)" value={draft.fullPaymentDueDaysBefore} onChange={(e) => setField('fullPaymentDueDaysBefore', e.target.value)} fullWidth size="small" />
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
