/**
 * FormDialog — standard form dialog: title, content, Annuler/Enregistrer actions.
 * fullScreen under the `sm` breakpoint (specs/ds-components.md §3.3 — CLAUDE.md dialog rule).
 *
 * Props: open, onClose, title, children, maxWidth ('sm'), fullWidth (true),
 *        cancelLabel ('Annuler'), submitLabel ('Enregistrer'), onSubmit, submitDisabled, submitColor,
 *        submitBusy (true while the submit is in flight: the button is disabled and spins, so a
 *        double click cannot send twice),
 *        secondaryAction (ReactNode, start-aligned in the actions row — e.g. a « Supprimer » button).
 *        Under `sm` the actions stack at full width, primary last, 44 px high.
 */
import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, CircularProgress, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

export default function FormDialog({
  open,
  onClose,
  title,
  children,
  maxWidth = 'sm',
  fullWidth = true,
  cancelLabel = 'Annuler',
  submitLabel = 'Enregistrer',
  onSubmit,
  submitDisabled,
  submitColor,
  submitBusy = false,
  secondaryAction,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth={fullWidth} fullScreen={fullScreen}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions
        sx={{
          // On a phone the actions stack at full width, the primary last, each a 44 px touch target.
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: { xs: 1, sm: 0 },
          '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } },
          '& .MuiButton-root': { minHeight: { xs: 44, sm: 'auto' } },
        }}
      >
        {secondaryAction}
        {secondaryAction && <Box sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }} />}
        <Button onClick={onClose}>{cancelLabel}</Button>
        <Button variant="contained" color={submitColor} onClick={onSubmit} disabled={submitDisabled || submitBusy}
          startIcon={submitBusy ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
