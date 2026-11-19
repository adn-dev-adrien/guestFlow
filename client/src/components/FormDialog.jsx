/**
 * FormDialog — standard form dialog: title, content, Annuler/Enregistrer actions.
 * Transitions are off under `prefers-reduced-motion`.
 * fullScreen under the `sm` breakpoint (specs/ds-components.md §3.3 — CLAUDE.md dialog rule).
 *
 * Props: open, onClose, title, children, maxWidth ('sm'), fullWidth (true),
 *        cancelLabel ('Annuler'), submitLabel ('Enregistrer'), onSubmit, submitDisabled, submitColor,
 *        hideSubmit (informational dialog: only the close button remains),
 *        submitBusy (true while the submit is in flight: the button is disabled and spins, so a
 *        double click cannot send twice),
 *        secondaryAction (ReactNode, start-aligned in the actions row — e.g. a « Supprimer » button).
 *        sheet (boolean, default false) — for a form whose content grows when the server answers: from `sm` up the dialog hangs from
 *        the top at the full height of the screen, its content scrolling inside, so neither what is drawn nor the actions move when an
 *        answer adds a section (loop t22 UI22-2). Under `sm` the dialog is full screen anyway.
 *        Under `sm` the actions stack at full width, primary last, 44 px high.
 */
import React from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Box, CircularProgress, useMediaQuery } from '@mui/material';
import FocusKeeper from './FocusKeeper';
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
  hideSubmit = false,
  secondaryAction,
  sheet = false,
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      fullScreen={fullScreen}
      transitionDuration={reduceMotion ? 0 : undefined}
      sx={sheet && !fullScreen ? { '& .MuiDialog-container': { alignItems: 'flex-start' }, '& .MuiDialog-paper': { height: 'calc(100% - 64px)', my: 4 } } : undefined}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{children}</DialogContent>
      {/* specs/plugins-phase-1-sdk.md rule 58 (I4) — the submit goes busy (disabled) on its click: the focus stays in the row. */}
      <FocusKeeper
        component={DialogActions}
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
        {!hideSubmit && (
          <Button variant="contained" color={submitColor} onClick={onSubmit} disabled={submitDisabled || submitBusy}
            startIcon={submitBusy ? <CircularProgress size={16} color="inherit" /> : undefined}>
            {submitLabel}
          </Button>
        )}
      </FocusKeeper>
    </Dialog>
  );
}
