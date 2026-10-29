/**
 * ConfirmDialog — standard confirmation prompt (destructive-by-default confirmColor).
 * fullScreen under the `sm` breakpoint (specs/ds-components.md §3.3 — CLAUDE.md dialog rule).
 *
 * Props: open, onClose, onConfirm, title ('Confirmer'), message,
 *        confirmLabel ('Confirmer'), cancelLabel ('Annuler'), confirmColor ('error'),
 *        secondaryLabel + onSecondary — an optional third way out, drawn outlined between the two
 *        (e.g. « Créer quand même » beside « Utiliser ce client »). The actions stack on `xs`.
 */
import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';

// Touch targets are at least 44 px (CLAUDE.md, responsive rules).
const TOUCH_TARGET = { minHeight: 44 };

export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Confirmer',
  message,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  confirmColor = 'error',
  secondaryLabel = null,
  onSecondary = null,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography>{message}</Typography>
      </DialogContent>
      <DialogActions
        sx={secondaryLabel ? {
          flexDirection: { xs: 'column-reverse', sm: 'row' },
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: 1,
          '& > :not(style) ~ :not(style)': { ml: { xs: 0, sm: 1 } },
        } : undefined}
      >
        <Button onClick={onClose} sx={TOUCH_TARGET}>{cancelLabel}</Button>
        {secondaryLabel && onSecondary && (
          <Button variant="outlined" color="inherit" onClick={onSecondary} sx={TOUCH_TARGET}>{secondaryLabel}</Button>
        )}
        <Button variant="contained" color={confirmColor} onClick={onConfirm} sx={TOUCH_TARGET}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
