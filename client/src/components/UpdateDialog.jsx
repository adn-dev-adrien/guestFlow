/**
 * UpdateDialog — what changed, then the decision (specs/self-update-and-releases.md §6.2).
 *
 * The release notes are read inside the application rather than behind a link to GitHub: the
 * operator is about to replace the software running their business, and the one moment they need
 * that information is this one.
 *
 * The sections arrive already parsed from the server (`info.notes`), so there is no markdown
 * renderer here — just a list.
 */
import React from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  List, ListItem, ListItemText, Typography, useMediaQuery, useTheme,
} from '@mui/material';

function formatDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function UpdateDialog({ open, info, starting, onClose, onConfirm }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  if (!info) return null;

  const publishedAt = formatDate(info.publishedAt);
  const notes = Array.isArray(info.notes) ? info.notes : [];
  const canInstall = info.selfUpdateSupported && !starting;

  return (
    <Dialog open={open} onClose={starting ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        Mise à jour vers GuestFlow {info.latest}
        {publishedAt && (
          <Typography variant="body2" color="text.secondary">Publiée le {publishedAt}</Typography>
        )}
      </DialogTitle>

      <DialogContent dividers>
        {notes.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Cette version ne détaille pas ses changements.
          </Typography>
        ) : (
          notes.map((section) => (
            <Box key={section.title || 'notes'} sx={{ mb: 2 }}>
              {section.title && (
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{section.title}</Typography>
              )}
              <List dense disablePadding>
                {section.items.map((item, index) => (
                  <ListItem key={`${section.title}-${index}`} sx={{ py: 0.25, pl: 1 }}>
                    <ListItemText
                      primary={item}
                      slotProps={{ primary: { variant: 'body2', color: 'text.secondary' } }}
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          ))
        )}

        {info.selfUpdateSupported ? (
          <Alert severity="info" sx={{ mt: 1 }}>
            Une sauvegarde de la base est effectuée avant l&apos;installation. L&apos;application sera
            indisponible environ une minute, puis la page se rechargera toute seule.
          </Alert>
        ) : (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {info.selfUpdateReason}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 1, '& > *': { width: { xs: '100%', sm: 'auto' } } }}>
        <Button onClick={onClose} disabled={starting} color="inherit">Plus tard</Button>
        <Button
          onClick={onConfirm}
          disabled={!canInstall}
          variant="contained"
          startIcon={starting ? <CircularProgress size={16} color="inherit" /> : null}
        >
          Installer maintenant
        </Button>
      </DialogActions>
    </Dialog>
  );
}
