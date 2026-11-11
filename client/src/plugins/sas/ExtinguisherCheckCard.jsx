/**
 * ExtinguisherCheckCard — « Contrôle de l'extincteur », the SAS plugin's setting
 * (specs/plugins-phase-p-productisation.md rule 16). Off by default; on, the departure SAS asks for
 * the extinguisher and its two repair rows join the billable list. Saved on toggle.
 *
 * Props: onChanged() — called after a save, so the page reloads the rows the server added.
 */
import React, { useEffect, useState } from 'react';
import { Card, CardContent, FormControlLabel, Switch, Typography } from '@mui/material';
import { api, useToast } from '../sdk';

const isOn = (value) => ['1', 'true'].includes(String(value ?? '').toLowerCase());

export default function ExtinguisherCheckCard({ onChanged }) {
  const { showError } = useToast();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    api.getPluginSettings('sas')
      .then((s) => setOn(isOn(s.extinguisherCheck)))
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);

  async function toggle(next) {
    setBusy(true);
    try {
      const saved = await api.savePluginSettings('sas', { extinguisherCheck: next ? '1' : '0' });
      setOn(isOn(saved.extinguisherCheck));
      if (onChanged) onChanged();
    } catch (err) {
      showError(err?.message || 'Échec de l’enregistrement.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <FormControlLabel
          control={<Switch checked={on} onChange={(e) => toggle(e.target.checked)} disabled={busy} />}
          label="Contrôle de l'extincteur"
          sx={{ minHeight: 44 }}
        />
        <Typography variant="body2" color="text.secondary">Étape du départ, avec ses frais de remise en état.</Typography>
      </CardContent>
    </Card>
  );
}
