/**
 * SettingsFormPage — the frame of every Paramètres page that edits settings
 * (specs/settings-rationalization.md rule 4 + §6): sticky PageActionBar with one Save / Cancel for
 * the page, the « unsaved changes » / « last update » subtitle, a single readable column, the
 * load-error alert and the dirty-form guard dialog.
 *
 * Props:
 *   title:         string            — page title in the action bar
 *   form:          object            — the useSettingsForm() result
 *   onSave?:       () => void        — defaults to form.save()
 *   onCancel?:     () => void        — defaults to form.cancel()
 *   dirty?:        boolean           — overrides form.isDirty (a card saving through its own endpoint)
 *   actionsBefore?: Action[]         — PageActionBar extra actions
 *   children:      ReactNode         — the page's cards
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import PageActionBar from './PageActionBar';
import ErrorAlert from './ErrorAlert';
import ConfirmDialog from './ConfirmDialog';

export default function SettingsFormPage({ title, form, onSave, onCancel, dirty, actionsBefore, children }) {
  const isDirty = dirty === undefined ? form.isDirty : dirty;
  const busy = form.loading || form.saving;
  const subtitle = isDirty ? (
    <Typography variant="caption" color="warning.main" sx={{ fontStyle: 'italic' }}>
      Modifications non enregistrées
    </Typography>
  ) : (form.updatedAtLabel ? (
    <Typography variant="caption" color="text.disabled">
      Dernière mise à jour : {form.updatedAtLabel}
    </Typography>
  ) : null);

  return (
    <Box>
      <PageActionBar
        title={title}
        titleOnXs
        subtitle={subtitle}
        onSave={onSave || (() => form.save())}
        saveDisabled={!isDirty || busy}
        saveBusy={form.saving}
        onCancel={onCancel || form.cancel}
        cancelDisabled={!isDirty || busy}
        actionsBefore={actionsBefore}
      />
      <Box sx={{ maxWidth: 880, mx: 'auto', p: { xs: 1.5, sm: 3 } }}>
        {form.loadError && (
          <ErrorAlert
            message="Impossible de charger les paramètres."
            onRetry={() => window.location.reload()}
            sx={{ mb: 2 }}
          />
        )}
        {children}
      </Box>
      <ConfirmDialog
        open={form.guardDialogOpen}
        onClose={form.dismissGuard}
        onConfirm={form.confirmLeave}
        title="Modifications non enregistrées"
        message="Vous avez des modifications non enregistrées. Quitter sans sauvegarder ?"
        confirmLabel="Quitter sans enregistrer"
        cancelLabel="Rester"
        confirmColor="error"
      />
    </Box>
  );
}
