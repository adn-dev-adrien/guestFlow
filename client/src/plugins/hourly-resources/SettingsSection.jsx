/**
 * SettingsSection — the « Ressources à l'heure » card of Paramètres › Intégrations
 * (specs/resource-booking-pricing-and-invoicing.md rule 5, A1): the VAT rate of a resource sold to a guest with no lodging
 * reservation. 20 % by default; a setting because the rate may change. An invoice already issued keeps its own rate.
 * No Save of its own: the page's bar saves it through the ref; the server validates the value.
 *
 * Props:
 *   onDirtyChange  (dirty: boolean) => void
 * Ref:
 *   save()   writes the draft;  reset()  drops it
 */
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Card, CardContent, InputAdornment, TextField, Typography } from '@mui/material';
import { api } from '../sdk';

const PLUGIN = 'hourly-resources';

function SettingsSection({ onDirtyChange }, ref) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getPluginSettings(PLUGIN).then((s) => { setSaved(s); setDraft(String(s.standaloneVatRate ?? '')); }).catch(() => {});
  }, []);

  const dirty = useMemo(() => Boolean(saved) && String(saved.standaloneVatRate ?? '') !== draft, [saved, draft]);
  useEffect(() => { if (onDirtyChange) onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  useImperativeHandle(ref, () => ({
    isDirty: () => dirty,
    async save() {
      if (!dirty) return;
      try {
        const next = await api.savePluginSettings(PLUGIN, { standaloneVatRate: draft });
        setSaved(next);
        setDraft(String(next.standaloneVatRate ?? ''));
        setError('');
      } catch (err) {
        setError((err.errors && err.errors.standaloneVatRate) || err.message || '');
        throw err;
      }
    },
    reset: () => { if (saved) setDraft(String(saved.standaloneVatRate ?? '')); setError(''); },
  }), [dirty, draft, saved]);

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 }, display: 'grid', gap: 1.5 }}>
        <Typography variant="h6">Ressources à l'heure</Typography>
        <TextField
          label="TVA des ventes hors séjour"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          error={Boolean(error)}
          helperText={error || 'Bain nordique, sauna… vendu à un client sans réservation de logement. Une facture émise garde son taux.'}
          sx={{ maxWidth: 320 }}
          slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }}
        />
      </CardContent>
    </Card>
  );
}

export default forwardRef(SettingsSection);
