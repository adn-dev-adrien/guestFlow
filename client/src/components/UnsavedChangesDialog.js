/**
 * UnsavedChangesDialog — the one unsaved-changes prompt (specs/ds-components.md §3.1).
 * Merges the two divergent implementations (PropertyDetail / ReservationPage): canonical wording
 * « Modifications non enregistrées », verb « Enregistrer », stay-button FIRST (design-system.md).
 *
 * Props:
 *   open:           bool
 *   onStay:         () => void   « Rester sur la page » (also the backdrop/escape close)
 *   onDiscard:      () => void   « Quitter sans enregistrer » (destructive)
 *   onSaveAndQuit:  () => void   « Enregistrer et quitter » (primary)
 */
import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

export default function UnsavedChangesDialog({ open, onStay, onDiscard, onSaveAndQuit }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog open={open} onClose={onStay} maxWidth="xs" fullWidth fullScreen={fullScreen}>
      <DialogTitle>Modifications non enregistrées</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          Vous avez des modifications non enregistrées. Voulez-vous les enregistrer avant de quitter ?
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onStay}>Rester sur la page</Button>
        <Button color="error" onClick={onDiscard}>Quitter sans enregistrer</Button>
        <Button variant="contained" onClick={onSaveAndQuit}>Enregistrer et quitter</Button>
      </DialogActions>
    </Dialog>
  );
}
