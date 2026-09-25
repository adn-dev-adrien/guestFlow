/**
 * TranslationCatalogueCard — Réglages → Système (specs/translation-catalogue.md rule 20).
 *
 * Translations are not typed into GuestFlow: it collects what needs translating, you download one
 * file, fill in the language columns and send it back. This card is the whole of that loop.
 *
 * Every number shown is computed by the server: what is translatable, what is still missing and what
 * changed in French since it was translated are all the catalogue's business, not this component's.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, Stack, Typography, Button, Box, Alert, Tooltip } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import api from '../api';
import FileUploadButton from './FileUploadButton';
import ConfirmDialog from './ConfirmDialog';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';

const LANG_NAMES = { en: 'anglais', de: 'allemand', es: 'espagnol', it: 'italien', nl: 'néerlandais' };

export default function TranslationCatalogueCard() {
  const [summary, setSummary] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  // A file waiting on the operator's answer: it removes translations, and rule 12 says we ask first.
  const [pendingRemoval, setPendingRemoval] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      setSummary(await api.getTranslationSummary());
    } catch (e) {
      setLoadError(e.message || 'Chargement impossible.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = async (csv, confirmRemovals) => {
    setBusy(true);
    setReport(null);
    try {
      const r = await api.importTranslations(csv, { confirmRemovals });
      const parts = [`${r.updated} traduction(s) mises à jour`];
      if (r.cleared) parts.push(`${r.cleared} retirée(s)`);
      if (r.reviewCleared) parts.push(`${r.reviewCleared} marquage(s) « à revérifier » levé(s)`);
      if (r.ignoredUnknown) parts.push(`${r.ignoredUnknown} clé(s) inconnue(s) ignorée(s)`);
      setReport({ severity: 'success', message: `${parts.join(' · ')}.` });
      await load();
    } catch (e) {
      if (e.error === 'REMOVALS_NOT_CONFIRMED') { setPendingRemoval({ csv, removals: e.removals }); return; }
      setReport({ severity: 'error', message: e.message || 'Envoi impossible.' });
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    setReport(null);
    try {
      const name = await api.downloadTranslations();
      setReport({ severity: 'info', message: `Fichier « ${name} » téléchargé — toutes les entrées, traduites ou non.` });
    } catch (e) {
      setReport({ severity: 'error', message: e.message || 'Téléchargement impossible.' });
    } finally {
      setBusy(false);
    }
  };

  const counts = () => {
    if (!summary) return '';
    const missing = Object.entries(summary.untranslated || {})
      .filter(([, n]) => n > 0)
      .map(([lang, n]) => `${n} sans ${LANG_NAMES[lang] || lang}`);
    const parts = [`${summary.total} texte${summary.total > 1 ? 's' : ''}`, ...missing];
    if (summary.needsReview) parts.push(`${summary.needsReview} à revérifier`);
    return parts.join(' · ');
  };

  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Typography variant="sectionHeader">Traductions</Typography>

          {loadError && <ErrorAlert message={loadError} onRetry={load} />}
          {!summary && !loadError && <LoadingState py={2} />}

          {summary && (
            <>
              <Tooltip title="« À revérifier » : le texte français a changé depuis la traduction.">
                <Typography variant="body2" color="text.secondary">{counts()}</Typography>
              </Tooltip>
              <Typography variant="body2" color="text.secondary">
                Les traductions se font dans un fichier : télécharge-le, remplis les colonnes de
                langue, renvoie-le. Pour ajouter une langue, ajoute simplement sa colonne.
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1 }}>
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={download}
                  disabled={busy}
                  sx={{ minHeight: 44 }}
                >
                  Télécharger le fichier
                </Button>
                <FileUploadButton
                  label="Envoyer un fichier"
                  accept=".csv,text/csv"
                  busy={busy}
                  onFile={(csv) => send(csv, false)}
                />
              </Box>
              {report && <Alert severity={report.severity}>{report.message}</Alert>}
            </>
          )}
        </Stack>
      </CardContent>

      <ConfirmDialog
        open={Boolean(pendingRemoval)}
        title={`Ce fichier retire ${pendingRemoval ? pendingRemoval.removals : 0} traduction(s)`}
        message={"Des cases de langue sont vides alors qu'une traduction existe aujourd'hui. Si ce n'est pas voulu, vérifie le fichier avant de continuer."}
        confirmLabel="Appliquer quand même"
        cancelLabel="Annuler"
        confirmColor="warning"
        onClose={() => { setPendingRemoval(null); setReport({ severity: 'info', message: "Envoi annulé — rien n'a été modifié." }); }}
        onConfirm={() => { const p = pendingRemoval; setPendingRemoval(null); send(p.csv, true); }}
      />
    </Card>
  );
}
