/**
 * MollieJournalCard — « Journal Mollie » of the Plan comptable page
 * (specs/mollie-rolling-reserve-and-incoming-payments.md rules 28-29): the journal code, the clearing account
 * (« compte d'attente » — the money Mollie still holds), the bank and fee accounts, and the switch that leaves the bank
 * lines out for an accountant who books the bank from the bank feed himself.
 *
 * Self-contained: it reads and writes the plugin's generic settings (`GET/PUT /api/plugins/accounting-export/settings`,
 * strings only — the switch is sent as '1' / '0'). The server validates and words a refusal (shown on the field, nothing
 * saved). Renders nothing when the settings cannot be read (a role that may not read them).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { api, useToast } from '../sdk';

const PLUGIN = 'accounting-export';
const FIELDS = [
  { key: 'mollieJournalCode', label: 'Code journal Mollie', helper: '1 à 4 majuscules ou chiffres.' },
  { key: 'mollieClearingAccount', label: 'Compte d’attente Mollie', helper: 'Ce que Mollie détient encore.' },
  { key: 'mollieBankAccount', label: 'Compte de banque', helper: 'Débité à chaque versement reçu.' },
  { key: 'mollieFeeAccount', label: 'Compte des frais Mollie', helper: 'Débité quand un règlement porte des frais.' },
];

export default function MollieJournalCard() {
  const { showError, showSuccess } = useToast();
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.getPluginSettings(PLUGIN);
      setForm({
        ...Object.fromEntries(FIELDS.map((f) => [f.key, s[f.key] || ''])),
        mollieExportBank: s.mollieExportBank !== '0',
      });
    } catch { setForm(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!form) return null;
  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: key === 'mollieJournalCode' ? e.target.value.toUpperCase().trim() : e.target.value.replace(/\s+/g, '') }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.savePluginSettings(PLUGIN, {
        ...Object.fromEntries(FIELDS.map((f) => [f.key, form[f.key]])),
        mollieExportBank: form.mollieExportBank ? '1' : '0',
      });
      setErrors({});
      showSuccess('Journal Mollie enregistré.');
    } catch (err) {
      setErrors(err && err.errors ? err.errors : {});
      showError((err && err.errors) ? 'Champs en erreur à vérifier.' : ((err && err.message) || 'Enregistrement impossible.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="outlined" data-testid="mollie-journal-card">
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="sectionHeader">Journal Mollie</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Les paiements par carte passent par un compte d’attente : au paiement, le client est soldé ; à chaque versement de Mollie, la banque est débitée.
        </Typography>
        <Stack gap={2}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            {FIELDS.map((field) => (
              <TextField
                key={field.key}
                label={field.label}
                value={form[field.key]}
                onChange={set(field.key)}
                error={Boolean(errors[field.key])}
                helperText={errors[field.key] || field.helper}
                slotProps={{ htmlInput: { inputMode: field.key === 'mollieJournalCode' ? 'text' : 'numeric' } }}
              />
            ))}
          </Box>
          <Box>
            <FormControlLabel
              control={<Switch checked={form.mollieExportBank} onChange={(e) => setForm((f) => ({ ...f, mollieExportBank: e.target.checked }))} />}
              label="Exporter les versements Mollie reçus"
            />
            <Typography variant="caption" color="text.secondary" component="div">
              Désactivé : seules les lignes du compte d’attente (paiements et frais) sont exportées, pour un cabinet qui passe la banque depuis le flux bancaire.
            </Typography>
          </Box>
          <Box><Button variant="contained" onClick={save} disabled={saving} sx={{ minHeight: 44, textTransform: 'none' }}>Enregistrer</Button></Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
