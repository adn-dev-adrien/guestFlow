/**
 * GateKeysAlert — Dashboard alert of the Sowel gate-keys connector
 * (specs/gate-access-sowel-connector.md §3.3 rules 13, 16, 17).
 *
 * One row per key Sowel could not create or revoke — « R-2026-041 · Marie », the reason under it —
 * and one row when Sowel has not read the list for more than 3 hours. A click on a failure opens the
 * reservation. Nothing is dismissible: a row leaves when Sowel reports a success, when the stay ends,
 * or when Sowel reads again.
 *
 * Renders nothing when there is nothing to say, or on fetch error (a dashboard card must never
 * break the page). Mirrors the TariffRecipeRunsAlert pattern.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, AlertTitle, Box, Divider, Stack, Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router';
import { api } from '../sdk';

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

const rowSx = {
  display: 'flex', alignItems: 'center', gap: 1,
  borderRadius: 1, px: 1, py: 1, mx: -1, minHeight: 44,
};

export default function GateKeysAlert() {
  const navigate = useNavigate();
  const [failures, setFailures] = useState([]);
  const [stale, setStale] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getGateKeysAlerts();
      setFailures(Array.isArray(payload?.failures) ? payload.failures : []);
      setStale(payload?.stale ? { lastReadAt: payload.lastReadAt || null } : null);
    } catch {
      setFailures([]);
      setStale(null);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (failures.length === 0 && !stale) return null;

  const open = (failure) => navigate(`/reservations/${failure.reservationId}`);

  return (
    <Alert
      severity="warning"
      variant="outlined"
      sx={{ mb: 3, borderWidth: 2, bgcolor: 'background.paper', '& .MuiAlert-message': { width: '100%' } }}
      icon={false}
    >
      <AlertTitle sx={{ fontWeight: 700 }}>Clés portail</AlertTitle>
      <Stack divider={<Divider flexItem />} spacing={0.5} sx={{ mt: 1 }}>
        {stale ? (
          <Box sx={rowSx}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Sowel ne lit plus les clés
                {stale.lastReadAt ? ` depuis le ${formatDateTime(stale.lastReadAt)}` : ''}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Les séjours à venir n&apos;auront pas de clé tant que Sowel ne relit pas la liste.
              </Typography>
            </Box>
          </Box>
        ) : null}
        {failures.map((failure) => (
          <Box
            key={failure.reservationId}
            role={failure.exists ? 'button' : undefined}
            tabIndex={failure.exists ? 0 : undefined}
            onClick={failure.exists ? () => open(failure) : undefined}
            onKeyDown={failure.exists
              ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(failure); } }
              : undefined}
            sx={{
              ...rowSx,
              cursor: failure.exists ? 'pointer' : 'default',
              '&:hover': failure.exists ? { bgcolor: 'action.hover' } : undefined,
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {failure.name} — {failure.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">{failure.reason}</Typography>
            </Box>
            {failure.exists ? <ChevronRightIcon fontSize="small" color="action" /> : null}
          </Box>
        ))}
      </Stack>
    </Alert>
  );
}
