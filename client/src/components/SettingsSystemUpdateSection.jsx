/**
 * SettingsSystemUpdateSection — « Système et mises à jour » in Réglages
 * (specs/self-update-and-releases.md §6.4).
 *
 * The permanent home of the feature: the installed version, when GitHub was last polled, what is
 * published, and the outcome of the last few updates. The dashboard alert is the notification; this
 * is the place you come back to.
 *
 * Composed from the shared StatusCard / SummaryItem / StatusBadge trio — no Settings-specific card.
 */
import React, { useState } from 'react';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import StatusCard from './StatusCard';
import CollapsibleSection from './CollapsibleSection';
import ErrorAlert from './ErrorAlert';
import useAppUpdate from '../hooks/useAppUpdate';
import UpdateDialog from './UpdateDialog';

function formatDateTime(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

const HISTORY_LABELS = {
  done: 'installée',
  failed: 'échouée',
  rolled_back: 'annulée (retour arrière)',
};

function badgeFor(info) {
  if (!info) return { status: 'neutral', label: 'Inconnu' };
  if (info.updateInProgress) return { status: 'warning', label: 'Mise à jour en cours' };
  if (info.updateAvailable) return { status: 'warning', label: `Version ${info.latest} disponible` };
  return { status: 'success', label: 'À jour' };
}

export default function SettingsSystemUpdateSection() {
  const { isAdmin, info, loading, checking, starting, error, checkNow, start } = useAppUpdate();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!isAdmin) return null;
  if (loading && !info) return null;
  if (!info) return <ErrorAlert message={error || 'Impossible de lire la version installée.'} />;

  const items = [
    { label: 'Version installée', value: info.current },
    { label: 'Dernière vérification', value: formatDateTime(info.lastCheckAt), valuePlaceholder: 'jamais' },
    {
      label: 'Version publiée',
      value: info.latest ? `${info.latest}${info.updateAvailable ? '' : ' (déjà installée)'}` : null,
      valuePlaceholder: 'aucune release publiée',
    },
  ];

  const history = Array.isArray(info?.history) ? info.history : [];

  return (
    <>
      <StatusCard
        title="Système et mises à jour"
        badge={badgeFor(info)}
        items={items}
        alert={info.selfUpdateSupported ? undefined : { severity: 'info', message: info.selfUpdateReason }}
        actions={(
          <>
            <Button
              onClick={checkNow}
              disabled={checking}
              startIcon={checking ? <CircularProgress size={16} /> : <RefreshIcon />}
            >
              Vérifier maintenant
            </Button>
            {info.updateAvailable && info.selfUpdateSupported && (
              <Button
                variant="contained"
                startIcon={<SystemUpdateAltIcon />}
                disabled={info.updateInProgress || starting}
                onClick={() => setDialogOpen(true)}
              >
                Installer la {info.latest}
              </Button>
            )}
          </>
        )}
      />

      {error && <ErrorAlert message={error} sx={{ mt: 2 }} />}

      {history.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <CollapsibleSection title="Historique des mises à jour" toggleLabel="Afficher l'historique">
            {history.map((entry, index) => (
              <Typography key={`${entry.at}-${index}`} variant="body2" color="text.secondary" sx={{ py: 0.25 }}>
                {formatDateTime(entry.at)} — {entry.from || '?'} → {entry.to || '?'} :{' '}
                {HISTORY_LABELS[entry.result] || entry.result}
                {entry.errorCode ? ` (${entry.errorCode})` : ''}
              </Typography>
            ))}
          </CollapsibleSection>
        </Box>
      )}

      <UpdateDialog
        open={dialogOpen}
        info={info}
        starting={starting}
        onClose={() => setDialogOpen(false)}
        onConfirm={async () => {
          const ok = await start(info.latest);
          if (ok) setDialogOpen(false);
        }}
      />
    </>
  );
}
