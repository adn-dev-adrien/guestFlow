/**
 * FormDialog — standard form dialog: title, content, Annuler/Enregistrer actions.
 * fullScreen under the `sm` breakpoint (specs/ds-components.md §3.3 — CLAUDE.md dialog rule).
 *
 * Props: open, onClose, title, children, maxWidth ('sm'), fullWidth (true),
 *        cancelLabel ('Annuler'), submitLabel ('Enregistrer'), onSubmit, submitDisabled, submitColor.
 */
import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, useMediaQuery } from '@mui/material';
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
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth={fullWidth} fullScreen={fullScreen}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{cancelLabel}</Button>
        <Button variant="contained" color={submitColor} onClick={onSubmit} disabled={submitDisabled}>
          {submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
