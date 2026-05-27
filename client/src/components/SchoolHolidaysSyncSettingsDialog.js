import React, { useEffect, useState } from 'react';
import { Box, TextField, Alert } from '@mui/material';
import FormDialog from './FormDialog';
import api from '../api';

export default function SchoolHolidaysSyncSettingsDialog({ open, onClose, initial, onSaved }) {
  const [intervalDays, setIntervalDays] = useState('60');
  const [horizonMonths, setHorizonMonths] = useState('24');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setIntervalDays(String(initial?.syncIntervalDays ?? 60));
      setHorizonMonths(String(initial?.syncHorizonMonths ?? 24));
      setError('');
    }
  }, [open, initial]);

  const intervalNum = Number(intervalDays);
  const horizonNum = Number(horizonMonths);
  const valid =
    Number.isInteger(intervalNum) && intervalNum >= 1 && intervalNum <= 365 &&
    Number.isInteger(horizonNum) && horizonNum >= 1 && horizonNum <= 60;

  const handleSubmit = async () => {
    setError('');
    try {
      await api.updateSchoolHolidaysSyncSettings({
        syncIntervalDays: intervalNum,
        syncHorizonMonths: horizonNum,
      });
      onSaved && onSaved({ syncIntervalDays: intervalNum, syncHorizonMonths: horizonNum });
      onClose();
    } catch (e) {
      setError(e?.body?.error || e?.message || 'Erreur lors de la mise à jour.');
    }
  };

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title="Paramètres de synchronisation"
      onSubmit={handleSubmit}
      submitDisabled={!valid}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        {error ? <Alert severity="error">{error}</Alert> : null}
        <TextField
          label="Fréquence de mise à jour (jours)"
          type="number"
          value={intervalDays}
          onChange={(e) => setIntervalDays(e.target.value)}
          inputProps={{ min: 1, max: 365, step: 1 }}
          helperText="Combien de jours entre deux synchronisations automatiques (1 à 365)."
          fullWidth
        />
        <TextField
          label="Horizon de mise à jour (mois)"
          type="number"
          value={horizonMonths}
          onChange={(e) => setHorizonMonths(e.target.value)}
          inputProps={{ min: 1, max: 60, step: 1 }}
          helperText="Jusqu'à combien de mois dans le futur récupérer les vacances (1 à 60)."
          fullWidth
        />
      </Box>
    </FormDialog>
  );
}
