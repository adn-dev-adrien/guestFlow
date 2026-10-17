/**
 * PluginUpdateDialog — the update of one plugin (specs/plugins-phase-4-registry.md rules 20, 22): the
 * changelog lines of the versions between the installed one and the offered one, newest first, and
 * one button « Mettre à jour ». A refusal (version of GuestFlow too old, missing requirement,
 * package refused, download impossible) is shown in the dialog, in the server's French words.
 * Plugin-specific; full screen on a phone (FormDialog).
 *
 * Props:
 *   open      boolean
 *   plugin    { name, version, update: { version, changelog: [{ version, lines }], refusal } } as
 *             GET /api/plugins returns it
 *   busy      boolean   the update is running
 *   error     string?   the refusal the last attempt received
 *   onClose   () => void
 *   onUpdate  () => void
 */
import React from 'react';
import { Alert, Box, Typography } from '@mui/material';
import FormDialog from './FormDialog';

export default function PluginUpdateDialog({ open, plugin, busy = false, error = null, onClose, onUpdate }) {
  if (!plugin || !plugin.update) return null;
  const { update } = plugin;
  const refusal = error || (update.refusal && update.refusal.message);
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={`${plugin.name} ${update.version}`}
      submitLabel="Mettre à jour"
      cancelLabel="Fermer"
      onSubmit={onUpdate}
      submitDisabled={Boolean(update.refusal)}
      submitBusy={busy}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Version installée : {plugin.version}. La mise à jour redémarre GuestFlow.
      </Typography>
      {update.changelog.length === 0 && (
        <Typography variant="body2" color="text.secondary">Aucune note pour cette version.</Typography>
      )}
      {update.changelog.map((entry) => (
        <Box key={entry.version} sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{entry.version}</Typography>
          <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
            {entry.lines.map((line) => <Typography component="li" variant="body2" key={line}>{line}</Typography>)}
          </Box>
        </Box>
      ))}
      {refusal && <Alert severity="warning" sx={{ mt: 1 }} role="alert">{refusal}</Alert>}
    </FormDialog>
  );
}
