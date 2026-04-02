import React, { createContext, useContext, useMemo, useState } from 'react';
import { Dialog, DialogActions, DialogContent, DialogTitle, Button, Typography } from '@mui/material';
import ConfirmDialog from './ConfirmDialog';
import FormDialog from './FormDialog';

const DialogContext = createContext(null);

export function useAppDialogs() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useAppDialogs must be used inside DialogProvider');
  return ctx;
}

export default function DialogProvider({ children }) {
  const [confirmState, setConfirmState] = useState(null);
  const [alertState, setAlertState] = useState(null);
  const [formState, setFormState] = useState(null);

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

  const value = useMemo(() => ({ confirm, alert, openForm }), []);

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

      <Dialog open={!!alertState} onClose={closeAlert} maxWidth="sm" fullWidth>
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
    </DialogContext.Provider>
  );
}
