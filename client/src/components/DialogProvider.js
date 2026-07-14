/**
 * DialogProvider — app-wide imperative dialogs + toasts (specs/ds-components.md §3.2).
 *
 *   const { confirm, alert, openForm } = useAppDialogs();
 *     confirm(options)  → Promise<boolean>   ConfirmDialog (options: title, message, confirmLabel,
 *                                            cancelLabel, confirmColor)
 *     alert(options)    → Promise<void>      information dialog (options OBJECT: title, message,
 *                                            buttonLabel — never a bare string)
 *     openForm(options) → Promise<boolean>   FormDialog (title, content, onSubmit, submitLabel…)
 *
 *   const { showSuccess, showError } = useToast();
 *     showSuccess(message)  bottom-center Snackbar, auto-hide 4 s
 *     showError(message)    idem, 6 s — the ONE post-action feedback channel (no inline Alerts,
 *                           no window.alert, no success modals).
 *
 * All dialogs are fullScreen under the `sm` breakpoint (CLAUDE.md responsive rule).
 */
import React, { createContext, useContext, useMemo, useState } from 'react';
import {
  Dialog, DialogActions, DialogContent, DialogTitle, Button, Typography,
  Snackbar, Alert, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ConfirmDialog from './ConfirmDialog';
import FormDialog from './FormDialog';

const DialogContext = createContext(null);

export function useAppDialogs() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useAppDialogs must be used inside DialogProvider');
  return ctx;
}

export function useToast() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useToast must be used inside DialogProvider');
  return { showSuccess: ctx.showSuccess, showError: ctx.showError };
}

export default function DialogProvider({ children }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [confirmState, setConfirmState] = useState(null);
  const [alertState, setAlertState] = useState(null);
  const [formState, setFormState] = useState(null);
  const [toast, setToast] = useState(null); // { key, severity, message }

  const confirm = (options) => new Promise((resolve) => {
    setConfirmState({
      title: 'Confirmer',
      message: '',
      confirmLabel: 'Confirmer',
      cancelLabel: 'Annuler',
      confirmColor: 'error',
      ...options,
      resolve,
    });
  });

  const alert = (options) => new Promise((resolve) => {
    setAlertState({
      title: 'Information',
      message: '',
      buttonLabel: 'Compris',
      ...options,
      resolve,
    });
  });

  const openForm = (options) => new Promise((resolve) => {
    setFormState({
      title: 'Formulaire',
      submitLabel: 'Enregistrer',
      cancelLabel: 'Annuler',
      submitDisabled: false,
      maxWidth: 'sm',
      fullWidth: true,
      onSubmit: null,
      content: null,
      ...options,
      resolve,
    });
  });

  // One toast at a time; a new message replaces the current one (key remount restarts the timer).
  const showSuccess = (message) => setToast({ key: `s-${message}`, severity: 'success', message });
  const showError = (message) => setToast({ key: `e-${message}`, severity: 'error', message });

  const closeConfirm = () => {
    if (confirmState?.resolve) confirmState.resolve(false);
    setConfirmState(null);
  };

  const acceptConfirm = () => {
    if (confirmState?.resolve) confirmState.resolve(true);
    setConfirmState(null);
  };

  const closeAlert = () => {
    if (alertState?.resolve) alertState.resolve();
    setAlertState(null);
  };

  const closeForm = () => {
    if (formState?.resolve) formState.resolve(false);
    setFormState(null);
  };

  const submitForm = async () => {
    if (!formState) return;
    if (formState.onSubmit) {
      await formState.onSubmit();
    }
    if (formState.resolve) formState.resolve(true);
    setFormState(null);
  };

  const closeToast = (_e, reason) => {
    if (reason === 'clickaway') return;
    setToast(null);
  };

  const value = useMemo(() => ({ confirm, alert, openForm, showSuccess, showError }), []);

  return (
    <DialogContext.Provider value={value}>
      {children}

      <ConfirmDialog
        open={!!confirmState}
        onClose={closeConfirm}
        onConfirm={acceptConfirm}
        title={confirmState?.title || 'Confirmer'}
        message={confirmState?.message || ''}
        confirmLabel={confirmState?.confirmLabel || 'Confirmer'}
        cancelLabel={confirmState?.cancelLabel || 'Annuler'}
        confirmColor={confirmState?.confirmColor || 'error'}
      />

      <Dialog open={!!alertState} onClose={closeAlert} maxWidth="sm" fullWidth fullScreen={fullScreen}>
        <DialogTitle>{alertState?.title || 'Information'}</DialogTitle>
        <DialogContent>
          <Typography>{alertState?.message || ''}</Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={closeAlert}>{alertState?.buttonLabel || 'Compris'}</Button>
        </DialogActions>
      </Dialog>

      <FormDialog
        open={!!formState}
        onClose={closeForm}
        title={formState?.title || 'Formulaire'}
        onSubmit={submitForm}
        submitDisabled={!!formState?.submitDisabled}
        submitLabel={formState?.submitLabel || 'Enregistrer'}
        cancelLabel={formState?.cancelLabel || 'Annuler'}
        maxWidth={formState?.maxWidth || 'sm'}
        fullWidth={formState?.fullWidth !== false}
      >
        {formState?.content}
      </FormDialog>

      <Snackbar
        key={toast?.key}
        open={!!toast}
        onClose={closeToast}
        autoHideDuration={toast?.severity === 'error' ? 6000 : 4000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 16 }, left: { xs: 16 }, right: { xs: 16 } }}
      >
        <Alert
          severity={toast?.severity || 'success'}
          onClose={closeToast}
          sx={(t) => ({
            width: '100%',
            fontWeight: 600,
            bgcolor: t.palette[toast?.severity || 'success'].soft,
            color: t.palette[toast?.severity || 'success'].main,
            '& .MuiAlert-icon': { color: 'inherit' },
          })}
        >
          {toast?.message || ''}
        </Alert>
      </Snackbar>
    </DialogContext.Provider>
  );
}
