import React from 'react';
import { Box, Alert, AlertTitle, Button, CircularProgress, IconButton, Typography, Tooltip } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import SyncIcon from '@mui/icons-material/Sync';

function timeAgoFromNow(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  const diffMin = Math.max(0, Math.round(diffMs / 60000));
  if (diffMin < 1) return 'à l’instant';
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH} h`;
  const diffD = Math.round(diffH / 24);
  return `il y a ${diffD} j`;
}

export default function SchoolHolidaysSyncBanner({ syncState, onSync, onOpenSettings, busy }) {
  const status = syncState?.lastSyncStatus || 'never';
  const isError = status === 'error';
  const severity = isError ? 'warning' : 'info';

  let primary;
  if (status === 'success') {
    const when = timeAgoFromNow(syncState?.lastSyncAt) || 'récemment';
    const count = syncState?.lastImportedCount ?? 0;
    primary = `Dernière mise à jour : ${when} (${count} période${count > 1 ? 's' : ''} importée${count > 1 ? 's' : ''}).`;
  } else if (isError) {
    primary = `Erreur lors de la dernière mise à jour : ${syncState?.lastSyncMessage || 'erreur inconnue'}.`;
  } else {
    primary = 'Aucune synchronisation effectuée pour le moment.';
  }

  const intervalDays = syncState?.syncIntervalDays ?? 60;
  const horizonMonths = syncState?.syncHorizonMonths ?? 24;

  return (
    <Alert
      severity={severity}
      sx={{ mb: 3, alignItems: 'center' }}
      action={
        <Button
          onClick={onSync}
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <SyncIcon />}
          size="small"
          variant="outlined"
        >
          Synchroniser maintenant
        </Button>
      }
    >
      <AlertTitle sx={{ mb: 0.5 }}>{primary}</AlertTitle>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          Sync auto tous les {intervalDays} j · horizon {horizonMonths} mois
        </Typography>
        <Tooltip title="Modifier les paramètres de synchronisation">
          <IconButton size="small" onClick={onOpenSettings} sx={{ p: 0.25 }}>
            <SettingsIcon fontSize="inherit" sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Alert>
  );
}
