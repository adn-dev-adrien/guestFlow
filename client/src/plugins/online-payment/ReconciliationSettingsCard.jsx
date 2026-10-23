/**
 * ReconciliationSettingsCard — « Rapprochement bancaire » of Paiements en ligne
 * (specs/qonto-bank-reconciliation.md rule 23): bank account, start date, the recognition patterns of
 * each platform, the acquirer's fee and the card fee. Saved through the plugin's generic settings
 * (`PUT /api/plugins/online-payment/settings`); the server validates and words a refusal.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api, useToast } from '../sdk/ui';

const PLUGIN = 'online-payment';
const parse = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };

export default function ReconciliationSettingsCard({ connected }) {
  const { showError, showSuccess } = useToast();
  const [form, setForm] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.getPluginSettings(PLUGIN);
      const fee = parse(s.reconciliationAcquiringFee, null);
      setForm({
        bankAccountId: s.reconciliationBankAccountId || '',
        startDate: s.reconciliationStartDate || '',
        patterns: Object.entries(parse(s.reconciliationPlatformPatterns, {})).map(([platform, list]) => `${platform}: ${list.join(', ')}`).join('\n'),
        feePercent: fee ? String(fee.percent) : '',
        feeFixedCents: fee ? String(fee.fixedCents) : '',
        cardFeePercent: s.reconciliationCardFeePercent || '',
      });
    } catch { setForm(null); }
  }, []);

  useEffect(() => { if (connected) load(); }, [connected, load]);
  useEffect(() => {
    if (!connected) return;
    api.getReconciliationBankAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, [connected]);

  if (!connected || !form) return null;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    const patterns = {};
    form.patterns.split('\n').map((l) => l.trim()).filter(Boolean).forEach((line) => {
      const at = line.indexOf(':');
      if (at > 0) patterns[line.slice(0, at).trim()] = line.slice(at + 1).split(',').map((p) => p.trim()).filter(Boolean);
    });
    setSaving(true);
    try {
      await api.savePluginSettings(PLUGIN, {
        reconciliationBankAccountId: form.bankAccountId,
        reconciliationStartDate: form.startDate,
        reconciliationPlatformPatterns: Object.keys(patterns).length ? JSON.stringify(patterns) : '',
        reconciliationAcquiringFee: form.feePercent === '' && form.feeFixedCents === '' ? '' : JSON.stringify({ percent: Number(form.feePercent || 0), fixedCents: Number(form.feeFixedCents || 0) }),
        reconciliationCardFeePercent: form.cardFeePercent,
      });
      setErrors({});
      showSuccess('Réglages du rapprochement enregistrés.');
    } catch (err) {
      setErrors(err && err.errors ? err.errors : {});
      showError((err && err.message) || 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="sectionHeader">Rapprochement bancaire</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Compte lu, date de mise en service et reconnaissance des virements.</Typography>
        <Stack gap={3}>
          <TextField select label="Compte bancaire" value={form.bankAccountId} onChange={set('bankAccountId')} error={Boolean(errors.reconciliationBankAccountId)} helperText={errors.reconciliationBankAccountId || 'Le compte principal par défaut.'}>
            {form.bankAccountId && !accounts.some((a) => a.id === form.bankAccountId) && <MenuItem value={form.bankAccountId}>Compte choisi</MenuItem>}
            {accounts.map((a) => <MenuItem key={a.id} value={a.id}>{a.name}{a.main ? ' (principal)' : ''}</MenuItem>)}
          </TextField>
          <TextField
            type="date" label="Mise en service" value={form.startDate} onChange={set('startDate')} slotProps={{ inputLabel: { shrink: true } }}
            error={Boolean(errors.reconciliationStartDate)} helperText={errors.reconciliationStartDate || 'Les séjours qui partent avant cette date ne sont pas rapprochés.'}
          />
          <TextField
            multiline minRows={3} label="Motifs de reconnaissance" value={form.patterns} onChange={set('patterns')}
            error={Boolean(errors.reconciliationPlatformPatterns)}
            helperText={errors.reconciliationPlatformPatterns || 'Une plateforme par ligne : « Booking: booking.com ». Vide : motifs d\'origine.'}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
            <TextField label="Frais du prestataire (%)" value={form.feePercent} onChange={set('feePercent')} slotProps={{ htmlInput: { inputMode: 'decimal' } }} error={Boolean(errors.reconciliationAcquiringFee)} helperText={errors.reconciliationAcquiringFee || ' '} />
            <TextField label="Frais fixes (centimes)" value={form.feeFixedCents} onChange={set('feeFixedCents')} slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
            <TextField label="Frais de carte (%)" value={form.cardFeePercent} onChange={set('cardFeePercent')} slotProps={{ htmlInput: { inputMode: 'decimal' } }} error={Boolean(errors.reconciliationCardFeePercent)} helperText={errors.reconciliationCardFeePercent || ' '} />
          </Box>
          <Box><Button variant="contained" onClick={save} disabled={saving} sx={{ minHeight: 44, textTransform: 'none' }}>Enregistrer</Button></Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
