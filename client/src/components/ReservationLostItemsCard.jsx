/**
 * ReservationLostItemsCard — « Objets oubliés » on a reservation (specs/guest-email-sequence.md
 * rule 33), quoted by the J+1 thank-you email. Feature-specific.
 *
 * Saved on its own PATCH, outside the reservation form: lost items are found AFTER the departure,
 * when the past-reservation lock already protects the rest of the fiche.
 *
 * Props:
 *   reservationId: number|string
 *   initialValue:  string
 */
import React, { useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, CircularProgress, TextField, Typography } from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import api from '../api';
import { useToast } from './DialogProvider';

export default function ReservationLostItemsCard({ reservationId, initialValue = '' }) {
  const [saved, setSaved] = useState(initialValue);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    setSaved(initialValue);
    setValue(initialValue);
  }, [initialValue]);

  const dirty = value.trim() !== String(saved || '').trim();

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.updateReservationLostItems(reservationId, value);
      setSaved(res.lostItems || '');
      setValue(res.lostItems || '');
      showSuccess('Objets oubliés enregistrés');
    } catch (err) {
      showError(err.error === 'LOST_ITEMS_TOO_LONG' ? '500 caractères au plus.' : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Typography variant="sectionHeader" sx={{ mb: 1, display: 'block' }}>Objets oubliés</Typography>
        <TextField
          label="Objets retrouvés après le départ"
          placeholder="ex. un doudou lapin bleu"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          helperText="Repris dans le mail de remerciement du lendemain du départ, qui propose de les renvoyer."
          fullWidth
          multiline
          minRows={1}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <Button
            variant="outlined"
            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
            onClick={save}
            disabled={!dirty || saving}
            sx={{ minHeight: 44, width: { xs: '100%', sm: 'auto' } }}
          >
            Mettre à jour les objets
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
