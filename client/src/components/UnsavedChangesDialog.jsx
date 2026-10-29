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

// Three actions: stacked full width on `xs` (primary on top), 44 px touch targets — like ConfirmDialog.
const TOUCH_TARGET = { minHeight: 44 };
const ACTIONS_SX = {
  flexDirection: { xs: 'column-reverse', sm: 'row' },
  alignItems: { xs: 'stretch', sm: 'center' },
  gap: 1,
  '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } },
};

export default function UnsavedChangesDialog({ open, onStay, onDiscard, onSaveAndQuit }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog open={open} onClose={onStay} maxWidth="xs" fullWidth fullScreen={fullScreen}>
      <DialogTitle>Modifications non enregistrées</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          Des modifications ne sont pas enregistrées. Les enregistrer avant de quitter ?
        </Typography>
      </DialogContent>
      <DialogActions sx={ACTIONS_SX}>
        <Button onClick={onStay} sx={TOUCH_TARGET}>Rester sur la page</Button>
        <Button color="error" onClick={onDiscard} sx={TOUCH_TARGET}>Quitter sans enregistrer</Button>
        <Button variant="contained" onClick={onSaveAndQuit} sx={TOUCH_TARGET}>Enregistrer et quitter</Button>
      </DialogActions>
    </Dialog>
  );
}
