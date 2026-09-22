/**
 * The CGV acceptance line of a fiche's Client block (specs/terms-acceptance-record.md rules 21-22).
 *
 * Pure renderer of the server block `{ termsAcceptanceState, termsAcceptance }`:
 *   - 'recorded'       → « CGV v3 acceptées le 21/09/2026 à 14:32:07 » + « Détails » (dialog with the
 *                        proof, and the archived text of the accepted version);
 *   - 'missing'        → a website request without acceptance, in the warning colour;
 *   - 'not_applicable' → nothing (a devis made in GuestFlow).
 *
 * Props:
 *   block: { termsAcceptanceState, termsAcceptance } | null
 */
import React, { useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import GavelIcon from '@mui/icons-material/Gavel';
import SummaryItem from '../SummaryItem';
import ArchivedHtmlDialog from '../ArchivedHtmlDialog';
import api from '../../api';

export default function TermsAcceptanceLine({ block }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [text, setText] = useState(null);

  if (!block || block.termsAcceptanceState === 'not_applicable') return null;

  if (block.termsAcceptanceState !== 'recorded') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'warning.main' }}>
        <GavelIcon sx={{ fontSize: 16 }} />
        <Typography variant="body2">CGV : aucune acceptation enregistrée</Typography>
      </Box>
    );
  }

  const a = block.termsAcceptance;

  const openText = async () => {
    setText({ loading: true, documents: [], error: '' });
    try {
      const v = await api.getTermsVersion(a.version);
      setText({
        loading: false,
        error: '',
        documents: [
          { key: 'fr', label: 'Français', html: v.html.fr },
          { key: 'en', label: 'English', html: v.html.en },
        ],
      });
    } catch {
      setText({ loading: false, documents: [], error: 'Impossible de charger le texte accepté.' });
    }
  };

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75 }}>
        <GavelIcon sx={{ fontSize: 16, color: 'success.main' }} />
        <Typography variant="body2">
          CGV v{a.version} acceptées le {a.acceptedAtLabel}
        </Typography>
        <Button size="small" variant="text" onClick={() => setDetailsOpen(true)} sx={{ minHeight: 32 }}>
          Détails
        </Button>
      </Box>

      <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} fullScreen={fullScreen} fullWidth maxWidth="sm">
        <DialogTitle>Acceptation des conditions générales</DialogTitle>
        <DialogContent dividers>
          <SummaryItem label="Acceptées le" value={`${a.acceptedAtLabel} (heure de Paris)`} />
          <SummaryItem label="Horodatage UTC" value={a.acceptedAt} />
          <SummaryItem label="Version" value={`v${a.version} publiée le ${a.versionPublishedAtLabel} · ${a.shortHash}`} />
          <SummaryItem label="Adresse IP" value={a.ip} />
          <SummaryItem label="Navigateur" value={a.userAgent} />
          <SummaryItem label="Plugin WordPress" value={a.pluginVersion} />
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={openText}>Voir le texte accepté</Button>
          <Button variant="contained" onClick={() => setDetailsOpen(false)}>Fermer</Button>
        </DialogActions>
      </Dialog>

      <ArchivedHtmlDialog
        open={Boolean(text)}
        onClose={() => setText(null)}
        title={`Conditions générales — version ${a.version}`}
        subtitle={`Texte accepté le ${a.acceptedAtLabel}, identique à ce que le client a vu`}
        documents={text?.documents || []}
        loading={Boolean(text?.loading)}
        error={text?.error || ''}
      />
    </>
  );
}
