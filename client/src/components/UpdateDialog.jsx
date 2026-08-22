/**
 * UpdateDialog — what changed, then the decision (specs/self-update-and-releases.md §6.2).
 *
 * The release notes are read inside the application rather than behind a link to GitHub: the
 * operator is about to replace the software running their business, and the one moment they need
 * that information is this one.
 *
 * What it shows is one digest per version the update crosses (`info.versions`, rule 20d): a handful
 * of short lines each, answering « what does this change for me? ». A version the operator skipped
 * is a version whose changelog they were never shown anywhere else, so the span — not just the
 * target — is what the dialog lists. The full sections stay one click away, for every listed
 * version at once: an operator who wants the detail can have it, without having to read it to reach
 * the button. Releases published before the digest convention carry none, and fall back to their
 * full list (rule 20c).
 *
 * Everything arrives already parsed, already split and already ordered by the server, so there is
 * no markdown renderer here and no decision to make — just a list.
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

/**
 * The heading a version carries inside the body. Only when the span holds more than one: on the
 * usual single-version update the dialog title and subtitle already name that version and that
 * date, and repeating them is noise on the screen the operator sees ninety-nine times out of a
 * hundred.
 */
function VersionHeading({ version, publishedAt }) {
  const published = formatDate(publishedAt);
  return (
    <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 700, mt: 1 }}>
      {version}{published ? ` — ${published}` : ''}
    </Typography>
  );
}

export default function UpdateDialog({ open, info, starting, onClose, onConfirm }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  if (!info) return null;

  const publishedAt = formatDate(info.publishedAt);
  const versions = Array.isArray(info.versions) ? info.versions : [];
  const multiple = versions.length > 1;
  // A version published before the digest convention has no summary. On its own it shows its
  // sections in place, exactly as those releases always did. Inside a span it does not: one version
  // deballing its whole changelog would bury the digests of the versions around it, which is the
  // problem rule 20c was written to solve in the first place. It says it has no digest, and its
  // detail waits behind the toggle with everyone else's.
  const inlineSectionsOf = (entry) => (!multiple && !entry.summary.length ? entry.notes : []);
  const foldedSections = versions.filter((entry) => entry.notes.length && (multiple || entry.summary.length));
  const canInstall = info.selfUpdateSupported && !starting;

  return (
    <Dialog open={open} onClose={starting ? undefined : onClose} fullScreen={fullScreen} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        Mise à jour vers GuestFlow {info.latest}
        {publishedAt && (
          <Typography variant="body2" color="text.secondary">Publiée le {publishedAt}</Typography>
        )}
        {multiple && (
          <Typography variant="body2" color="text.secondary">
            {versions.length} versions depuis la {info.current}
          </Typography>
        )}
      </DialogTitle>

      <DialogContent dividers>
        {versions.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            Cette version ne détaille pas ses changements.
          </Typography>
        )}

        {versions.map((entry) => (
          <Box key={entry.version} sx={{ mb: multiple ? 2 : 0 }}>
            {multiple && <VersionHeading version={entry.version} publishedAt={entry.publishedAt} />}
            {entry.summary.length > 0 && <NoteList items={entry.summary} dense={false} />}
            {multiple && entry.summary.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ pl: 1 }}>
                Pas de résumé pour cette version.
              </Typography>
            )}
            {inlineSectionsOf(entry).length > 0 && (
              <Box sx={{ mt: 1 }}><NoteSections sections={inlineSectionsOf(entry)} /></Box>
            )}
          </Box>
        ))}

        {info.versionsTruncated && versions.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Les versions antérieures à {versions[versions.length - 1].version} ne sont pas listées.
          </Typography>
        )}

        {foldedSections.length > 0 && (
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
              <Box sx={{ mt: 1 }}>
                {foldedSections.map((entry) => (
                  <Box key={entry.version}>
                    {multiple && <VersionHeading version={entry.version} publishedAt={entry.publishedAt} />}
                    <NoteSections sections={entry.notes} />
                  </Box>
                ))}
              </Box>
            </Collapse>
          </>
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
