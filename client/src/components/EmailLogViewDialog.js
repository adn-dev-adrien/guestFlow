/**
 * EmailLogViewDialog — read-only preview of a historical email log row.
 * See specs/email-automation.md §6.5.
 */

import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Box,
  Typography, Stack, Chip,
} from '@mui/material';

function statusLabel(status) {
  if (status === 'sent') return { label: 'Envoyé', color: 'success' };
  if (status === 'failed') return { label: 'Échec', color: 'error' };
  if (status === 'acknowledged-skip') return { label: 'Ignoré', color: 'default' };
  return { label: status || '—', color: 'default' };
}

export default function EmailLogViewDialog({ open, row, onClose }) {
  if (!row) return null;
  const status = statusLabel(row.status);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Aperçu de l'email</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Chip label={status.label} color={status.color} size="small" variant="outlined" />
            <Typography variant="body2" color="text.secondary">
              {row.templateName || '(modèle supprimé)'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              → {row.recipientEmail || '—'}
            </Typography>
          </Stack>

          {row.status === 'failed' && row.errorMessage ? (
            <Box sx={{ p: 1.5, bgcolor: 'error.lighter', border: '1px solid', borderColor: 'error.light', borderRadius: 1 }}>
              <Typography variant="body2" color="error.main" sx={{ fontWeight: 600 }}>
                Erreur : {row.errorMessage}
              </Typography>
            </Box>
          ) : null}

          <Box>
            <Typography variant="caption" color="text.secondary">Sujet</Typography>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>{row.renderedSubject}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Corps</Typography>
            <Box
              component="pre"
              sx={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                bgcolor: 'grey.50',
                p: 2,
                borderRadius: 1,
                border: '1px solid',
                borderColor: 'divider',
                mt: 0.5,
              }}
            >
              {row.renderedBody}
            </Box>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fermer</Button>
      </DialogActions>
    </Dialog>
  );
}
