/**
 * UpdateDialog — what changed, then the decision (specs/self-update-and-releases.md §6.2).
 *
 * The release notes are read inside the application rather than behind a link to GitHub: the
 * operator is about to replace the software running their business, and the one moment they need
 * that information is this one.
 *
 * What it shows first is the digest the release carries (`info.summary`): a handful of short lines
 * that answer « what does this change for me? ». The full sections (`info.notes`) stay one click
 * away — an operator who wants the detail can have it, without having to read it to reach the
 * button. Releases published before the digest convention carry none, and fall back to the full
 * list (§6.2 rule 20c).
 *
 * Both arrive already parsed and already split by the server, so there is no markdown renderer here
 * and no decision to make — just a list.
 */
import React from 'react';
import {
  Alert, Box, Button, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  List, ListItem, ListItemText, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

function NoteList({ items, dense = true }) {
  return (
    <List dense={dense} disablePadding>
      {items.map((item, index) => (
        <ListItem key={index} sx={{ py: 0.25, pl: 1 }}>
          <ListItemText
            primary={item}
            slotProps={{ primary: { variant: 'body2', color: 'text.secondary' } }}
          />
        </ListItem>
      ))}
    </List>
  );
}

function NoteSections({ sections }) {
  return sections.map((section) => (
    <Box key={section.title || 'notes'} sx={{ mb: 2 }}>
      {section.title && (
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{section.title}</Typography>
      )}
      <NoteList items={section.items} />
    </Box>
  ));
}

function formatDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function UpdateDialog({ open, info, starting, onClose, onConfirm }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  if (!info) return null;

  const publishedAt = formatDate(info.publishedAt);
  const notes = Array.isArray(info.notes) ? info.notes : [];
  const summary = Array.isArray(info.summary) ? info.summary : [];
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
        {summary.length === 0 && notes.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Cette version ne détaille pas ses changements.
          </Typography>
        )}

        {summary.length > 0 && <NoteList items={summary} dense={false} />}

        {summary.length > 0 && notes.length > 0 && (
          <>
            <Button
              size="small"
              color="inherit"
              onClick={() => setDetailsOpen((wasOpen) => !wasOpen)}
              endIcon={detailsOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              sx={{ mt: 1, textTransform: 'none' }}
            >
              {detailsOpen ? 'Masquer le détail' : 'Tout le changelog'}
            </Button>
            <Collapse in={detailsOpen} unmountOnExit>
              <Box sx={{ mt: 1 }}><NoteSections sections={notes} /></Box>
            </Collapse>
          </>
        )}

        {summary.length === 0 && notes.length > 0 && <NoteSections sections={notes} />}

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
