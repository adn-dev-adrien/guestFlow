/**
 * LinenShortageAlert — Dashboard alert for projected linen / towel shortages
 * (specs/linen-inventory-shortage-tracking.md §6.3).
 *
 * Self-contained: fetches its own data on mount + on every route change so navigating back to
 * the Dashboard refreshes the projection (cheap fetch, server is bounded). Renders nothing
 * when there's no shortage in the horizon.
 *
 * UX: one red `<Alert>` at the top of the Dashboard, body grouped by linen type. Each type
 * shows: first shortage date, max missing quantity, clickable reservation chips that navigate
 * to the reservation page on click.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AlertTitle, Box, Typography, Stack, Chip } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../api';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default function LinenShortageAlert() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getLinenShortageAlert();
      setData(payload);
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!data || !Array.isArray(data.shortagesByType) || data.shortagesByType.length === 0) {
    return null;
  }

  const totalShortages = data.shortagesByType.length;
  const horizonLabel = formatDate(data.horizon);

  return (
    <Alert severity="error" variant="outlined" sx={{ mb: 3, borderWidth: 2, bgcolor: 'background.paper' }}>
      <AlertTitle sx={{ fontWeight: 700 }}>
        Stock insuffisant — {totalShortages} rupture{totalShortages > 1 ? 's' : ''} prévue{totalShortages > 1 ? 's' : ''} d&apos;ici le {horizonLabel}
      </AlertTitle>
      <Stack spacing={2} sx={{ mt: 1 }}>
        {data.shortagesByType.map((entry) => (
          <Box key={entry.type}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{entry.label}</Typography>
            <Typography variant="body2" color="text.secondary">
              Première rupture le <strong>{formatDate(entry.firstShortageDate)}</strong>
              {' · '}jusqu&apos;à <strong>−{entry.maxMissing} manquant{entry.maxMissing > 1 ? 's' : ''}</strong>
            </Typography>
            {entry.impactedReservations.length > 0 && (
              <Box sx={{ mt: 0.75 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                  Réservations impactées :
                </Typography>
                <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.5, display: 'inline-flex' }}>
                  {entry.impactedReservations.map((r) => (
                    <Chip
                      key={r.id}
                      label={r.clientName || `#${r.id}`}
                      size="small"
                      color="error"
                      variant="outlined"
                      clickable
                      onClick={() => navigate(`/reservations/${r.id}`)}
                    />
                  ))}
                </Stack>
              </Box>
            )}
          </Box>
        ))}
      </Stack>
    </Alert>
  );
}
