/**
 * PaymentsSettingsPage — dedicated "Paiements" settings page (specs/online-payments-qonto.md §3.1/§3.2).
 *
 * Sections (server-driven):
 *   1. Qonto bank connection — OAuth status + "Connecter Qonto" button. The OAuth callback returns here
 *      with ?qonto=connected|error|invalid_state.
 *   2. Provider connection — once OAuth is connected but the payment-links provider isn't enabled yet,
 *      a form (bank account / phone / website / description) calls connect-provider. A `pending`
 *      connection redirects to the Qonto/Mollie onboarding (KYC); the return lands here with
 *      ?provider=callback, which re-checks the status.
 *   3. Délais & relances — deposit/balance reminder & deadline durations, editable.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  Box, Card, CardContent, Typography, TextField, Button, Stack, CircularProgress,
  Select, MenuItem, FormControl, InputLabel, Divider,
} from '@mui/material';

import PageActionBar from '../components/PageActionBar';
import { useToast } from '../components/DialogProvider';
import ErrorAlert from '../components/ErrorAlert';
import ConfirmDialog from '../components/ConfirmDialog';
import useDirtyFormGuard from '../hooks/useDirtyFormGuard';
import StatusCard from '../components/StatusCard';
import api from '../api';

const offsetsToText = (arr) => (Array.isArray(arr) ? arr.join(', ') : '');
// Normalise a phone to E.164, tolerating the French national form (e.g. "06 28 05 60 66" → "+33628056066").
// Mirrors the server's paymentProviderValidation.normalizePhone so the button-enable check matches.
const normalizeFrPhone = (raw) => {
  const p = String(raw || '').replace(/[\s().-]/g, '');
  if (!p) return '';
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return `+${p.slice(2)}`;
  if (/^0\d{9}$/.test(p)) return `+33${p.slice(1)}`;
  return p;
};
const textToOffsets = (txt) => String(txt || '')
  .split(',').map((s) => s.trim()).filter((s) => s !== '')
  .map(Number).filter((n) => Number.isInteger(n));

const DAY_FIELDS = [
  'depositAbandonOffset', 'depositLinkExpiryDays',
  'balanceAbandonOffset', 'balanceLinkExpiryDays',
];

const EMPTY_PROVIDER_FORM = { bankAccountId: '', phone: '', websiteUrl: 'https://domainesolio.com', businessDescription: '' };

export default function PaymentsSettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [qonto, setQonto] = useState(null);
  const [draft, setDraft] = useState(null);
  const [savedDraft, setSavedDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  // Load failures stay persistent (ErrorAlert); action failures toast
  // (specs/ds-sweep-settings.md §3.3 — the old single `error` state mixed both).
  const [loadError, setLoadError] = useState(false);
  const { showSuccess, showError } = useToast();

  // Provider connection.
  const [bankAccounts, setBankAccounts] = useState(null); // null = not loaded yet
  const [providerForm, setProviderForm] = useState(EMPTY_PROVIDER_FORM);
  const [connecting, setConnecting] = useState(false);

  // Navigation guard on unsaved timing changes (specs/ds-sweep-settings.md §3.7).
  const { isDirty, guardDialogOpen, dismissGuard, confirmLeave } = useDirtyFormGuard({
    draft: draft || {},
    saved: savedDraft || {},
    navigate,
  });

  const load = useCallback(async () => {
    const data = await api.getPaymentSettings();
    setQonto(data.qonto);
    const shaped = {
      ...data.timings,
      depositReminderOffsetsText: offsetsToText(data.timings.depositReminderOffsets),
      balanceReminderOffsetsText: offsetsToText(data.timings.balanceReminderOffsets),
    };
    setDraft(shaped);
    setSavedDraft(shaped);
    return data.qonto;
  }, []);

  useEffect(() => { load().catch(() => setLoadError(true)); }, [load]);

  // OAuth callback feedback.
  useEffect(() => {
    const q = new URLSearchParams(location.search).get('qonto');
    if (q === 'connected') showSuccess('Qonto connecté ✓');
    else if (q === 'error') showError('Échec de la connexion Qonto — vérifie les identifiants et les logs.');
    else if (q === 'invalid_state') showError('Connexion Qonto invalide (state). Réessaie depuis cette page.');
  }, [location.search]);

  // Return from the provider onboarding (KYC) → re-check the status.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('provider') !== 'callback') return;
    api.refreshQontoConnection()
      .then((r) => {
        setQonto((prev) => (prev ? { ...prev, connectionStatus: r.connectionStatus } : prev));
        showSuccess(r.connectionStatus === 'enabled' ? 'Provider de liens activé ✓' : `Connexion provider : ${r.connectionStatus}`);
      })
      .catch((e) => showError(e.message || 'Impossible de vérifier le statut du provider.'));
  }, [location.search]);

  // Load the bank accounts once OAuth is connected and the provider isn't enabled yet.
  const needsProvider = Boolean(qonto && qonto.connected && qonto.connectionStatus !== 'enabled');
  useEffect(() => {
    if (!needsProvider || bankAccounts !== null) return;
    api.getQontoBankAccounts()
      .then((r) => {
        const accounts = Array.isArray(r.bankAccounts) ? r.bankAccounts : [];
        setBankAccounts(accounts);
        // Preselect the main / only account.
        const preset = accounts.find((a) => a.main) || (accounts.length === 1 ? accounts[0] : null);
        if (preset) setProviderForm((f) => ({ ...f, bankAccountId: preset.id }));
      })
      .catch(() => setBankAccounts([])); // a load failure shows an empty picker + a hint
  }, [needsProvider, bankAccounts]);

  const setField = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const setProviderField = (key, value) => setProviderForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        depositReminderOffsets: textToOffsets(draft.depositReminderOffsetsText),
        balanceReminderOffsets: textToOffsets(draft.balanceReminderOffsetsText),
      };
      DAY_FIELDS.forEach((f) => { payload[f] = Number(draft[f]); });
      const res = await api.updatePaymentSettings(payload);
      const next = (d) => ({
        ...d, ...res.timings,
        depositReminderOffsetsText: offsetsToText(res.timings.depositReminderOffsets),
        balanceReminderOffsetsText: offsetsToText(res.timings.balanceReminderOffsets),
      });
      setDraft(next);
      setSavedDraft((prev) => next(prev || {}));
      showSuccess('Délais enregistrés ✓');
    } catch (e) {
      showError(e.message || "Échec de l'enregistrement (vérifie les valeurs).");
    } finally {
      setSaving(false);
    }
  };

  const handleRegisterWebhook = async () => {
    try {
      await api.registerQontoWebhook();
      showSuccess('Webhook Qonto enregistré ✓ (les paiements seront confirmés en temps réel)');
    } catch (e) {
      showError(e?.body?.message || e.message || "Échec de l'enregistrement du webhook (QONTO_WEBHOOK_SECRET + URL publique requis).");
    }
  };

  const handleConnectProvider = async () => {
    setConnecting(true);
    try {
      const r = await api.connectQontoProvider({ ...providerForm, phone: normalizeFrPhone(providerForm.phone) });
      if (r.connectionLocation) {
        // pending → send the operator to the Qonto/Mollie onboarding (KYC); they return to ?provider=callback.
        window.location.href = r.connectionLocation;
        return;
      }
      setQonto((prev) => (prev ? { ...prev, connectionStatus: r.connectionStatus } : prev));
      showSuccess(r.connectionStatus === 'enabled' ? 'Provider de liens activé ✓' : `Connexion provider : ${r.connectionStatus}`);
    } catch (e) {
      const messages = e?.body?.messages;
      showError(Array.isArray(messages) ? messages.join(' · ') : (e.message || 'Échec de la connexion du provider.'));
    } finally {
      setConnecting(false);
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
  const descLen = providerForm.businessDescription.trim().length;
  const providerFormValid = providerForm.bankAccountId
    && /^\+[1-9]\d{6,14}$/.test(normalizeFrPhone(providerForm.phone))
    && /^https?:\/\/[^\s]+\.[^\s]+/i.test(providerForm.websiteUrl)
    && descLen >= 80;

  return (
    <Box>
      <PageActionBar title="Paiements" backTo="/settings" onSave={handleSave} saveDisabled={!isDirty} saveBusy={saving} />
      <Box sx={{ p: { xs: 1.5, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 900, mx: 'auto' }}>
        {loadError && <ErrorAlert message="Impossible de charger les paramètres de paiement." onRetry={() => window.location.reload()} />}

        <StatusCard
          title="Connexion bancaire (Qonto)"
          badge={connected ? { status: 'success', label: 'Connecté' } : { status: 'warning', label: 'Non connecté' }}
          items={[
            { label: 'Mode', value: qonto.sandbox ? 'Sandbox (test)' : 'Production' },
            { label: 'Identifiants', value: qonto.configured ? 'Configurés' : 'Manquants (.env.local)' },
            { label: 'Provider de liens', value: providerEnabled ? 'Activé' : (qonto.connectionStatus || 'non connecté') },
          ]}
          actions={(
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
              <Button
                variant={connected ? 'outlined' : 'contained'}
                disabled={!qonto.configured}
                onClick={() => { window.location.href = '/api/payments/qonto/authorize'; }}
              >
                {connected ? 'Reconnecter Qonto' : 'Connecter Qonto'}
              </Button>
              {connected && (
                <Button variant="outlined" onClick={handleRegisterWebhook}>
                  Enregistrer le webhook
                </Button>
              )}
            </Box>
          )}
        />

        {connected && !providerEnabled && (
          <Card variant="outlined">
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="sectionHeader" sx={{ display: 'block', mb: 1 }}>Connexion du provider de liens</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Dernière étape avant de pouvoir générer des liens de paiement : on connecte ton compte
                Qonto au provider de paiement. Une vérification (KYC) peut être demandée — tu seras alors
                redirigé vers Qonto puis ramené ici.
              </Typography>
              <Stack spacing={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="ba-label">Compte bancaire</InputLabel>
                  <Select
                    labelId="ba-label"
                    label="Compte bancaire"
                    value={providerForm.bankAccountId}
                    onChange={(e) => setProviderField('bankAccountId', e.target.value)}
                  >
                    {(bankAccounts || []).map((a) => (
                      <MenuItem key={a.id} value={a.id}>{a.name || a.iban || a.id}{a.iban ? ` — ${a.iban}` : ''}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {bankAccounts && bankAccounts.length === 0 && (
                  <Typography variant="caption" color="error">Aucun compte récupéré — vérifie la connexion Qonto (logs).</Typography>
                )}
                <TextField label="Téléphone (format international, ex. +33612345678)" value={providerForm.phone} onChange={(e) => setProviderField('phone', e.target.value)} fullWidth size="small" />
                <TextField label="Site web" value={providerForm.websiteUrl} onChange={(e) => setProviderField('websiteUrl', e.target.value)} fullWidth size="small" />
                <TextField
                  label="Description de l'activité (≥ 80 caractères)"
                  value={providerForm.businessDescription}
                  onChange={(e) => setProviderField('businessDescription', e.target.value)}
                  fullWidth multiline minRows={3} size="small"
                  helperText={`${descLen} / 80 caractères minimum`}
                  error={descLen > 0 && descLen < 80}
                />
                <Divider />
                <Button variant="contained" onClick={handleConnectProvider} disabled={!providerFormValid || connecting}>
                  {connecting ? <CircularProgress size={20} color="inherit" /> : 'Connecter le provider'}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}

        <Card variant="outlined">
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography variant="sectionHeader" sx={{ display: 'block', mb: 1 }}>Délais &amp; relances</Typography>
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
            </Stack>
          </CardContent>
        </Card>
      </Box>
      <ConfirmDialog
        open={guardDialogOpen}
        onClose={dismissGuard}
        onConfirm={confirmLeave}
        title="Modifications non enregistrées"
        message="Vous avez des modifications non enregistrées. Quitter sans sauvegarder ?"
        confirmLabel="Quitter sans enregistrer"
        cancelLabel="Rester"
        confirmColor="error"
      />
    </Box>
  );
}
