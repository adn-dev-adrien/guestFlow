/**
 * ConfirmDialog — standard confirmation prompt (destructive-by-default confirmColor).
 * fullScreen under the `sm` breakpoint (specs/ds-components.md §3.3 — CLAUDE.md dialog rule).
 *
 * Props: open, onClose, onConfirm, title ('Confirmer'), message,
 *        confirmLabel ('Confirmer'), cancelLabel ('Annuler'), confirmColor ('error').
 */
import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Confirmer',
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  confirmColor = 'error',
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography>{message}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{cancelLabel}</Button>
        <Button variant="contained" color={confirmColor} onClick={onConfirm}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
