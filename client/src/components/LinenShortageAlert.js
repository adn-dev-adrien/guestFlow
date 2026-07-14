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
import { displayDateLong } from '../utils/formatters';

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
  // Lead with the EARLIEST first-shortage date — the actionable date for the operator. The
  // projection horizon (last reservation's checkout) is a meaningless upper bound here (a single
  // far-future booking would push it months out), so it's no longer used in the title.
  const earliestShortageDate = data.shortagesByType
    .map((e) => e.firstShortageDate)
    .filter(Boolean)
    .sort()[0];

  return (
    <Alert severity="error" variant="outlined" sx={{ mb: 3, borderWidth: 2, bgcolor: 'background.paper' }}>
      <AlertTitle sx={{ fontWeight: 700 }}>
        Stock blanchisserie insuffisant — {totalShortages} type{totalShortages > 1 ? 's' : ''} de linge en rupture
        {earliestShortageDate ? <> à partir du {displayDateLong(earliestShortageDate)}</> : null}
      </AlertTitle>
      <Stack spacing={2} sx={{ mt: 1 }}>
        {data.shortagesByType.map((entry) => (
          <Box key={entry.type}>
            <Typography variant="body2" color="text.secondary">
              <strong>{entry.label}</strong> : jusqu&apos;à <strong>{entry.maxMissing} manquant{entry.maxMissing > 1 ? 's' : ''}</strong>
              {' · '}première rupture le <strong>{displayDateLong(entry.firstShortageDate)}</strong>
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
