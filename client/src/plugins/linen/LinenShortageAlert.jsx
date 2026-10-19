/**
 * LinenShortageAlert — Dashboard alert for projected linen / towel shortages
 * (specs/linen-inventory-shortage-tracking.md §6.3).
 *
 * Self-contained: fetches its own data on mount + on every route change so navigating back to
 * the Dashboard refreshes the projection (cheap fetch, server is bounded). Renders nothing
 * when there's no shortage in the horizon.
 *
 * UX: one `AttentionCard` (title, count and « N types en rupture à partir du … » from the server,
 * specs/shell-and-home-day-first.md rule 6), body grouped by linen type. Each type
 * shows: first shortage date, max missing quantity, clickable reservation chips that navigate
 * to the reservation page on click.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Typography, Stack, Chip } from '@mui/material';
import { useNavigate } from 'react-router';
import { api, displayDateLong, AttentionCard } from '../sdk';

export default function LinenShortageAlert({ attention }) {
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

  return (
    <AttentionCard attention={attention}>
      <Stack spacing={2}>
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
    </AttentionCard>
  );
}
