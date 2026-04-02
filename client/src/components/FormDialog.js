import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';

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
  return (
    <Dialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth={fullWidth}>
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
