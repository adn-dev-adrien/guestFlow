/**
 * RepairedReservationNumbersAlert — Dashboard card listing the stays that were left without a number
 * and numbered at boot (specs/reservation-number-and-search.md rule 15). Such a stay may be the ghost
 * of a creation that failed: it still blocks its dates and leaves in the iCal export, so it stays on
 * the card until the operator has opened it and said « Vu ».
 *
 * Self-contained, no props: fetches its own list on mount. Each row opens the reservation; « Vu »
 * acknowledges it on the server and drops it. Renders nothing when the list is empty or the fetch
 * fails (a dashboard card must never break the page).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Button, Divider, Stack, Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate } from 'react-router';
import api from '../api';
import AttentionCard from './AttentionCard';
import { displayDateShort } from '../utils/formatters';

export default function RepairedReservationNumbersAlert({ attention }) {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getRepairedReservationNumbers();
      setAlerts(Array.isArray(payload?.alerts) ? payload.alerts : []);
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const acknowledge = async (reservationId) => {
    setBusyId(reservationId);
    try {
      await api.acknowledgeRepairedReservationNumber(reservationId);
      setAlerts((prev) => prev.filter((a) => a.reservationId !== reservationId));
    } catch {
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (alerts.length === 0) return null;

  const open = (reservationId) => navigate(`/reservations/${reservationId}`);

  return (
    <AttentionCard attention={attention}>
      <Stack divider={<Divider flexItem />} spacing={0.5}>
        {alerts.map((alert) => (
          <Box
            key={alert.reservationId}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}
          >
            <Box
              role="button"
              tabIndex={0}
              onClick={() => open(alert.reservationId)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(alert.reservationId); } }}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0,
                cursor: 'pointer', borderRadius: 1, px: 1, py: 1, mx: -1, minHeight: 44,
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                  N° {alert.reservationNumber} · {alert.clientName}
                  {alert.propertyName ? ` · ${alert.propertyName}` : ''}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Du <strong>{displayDateShort(alert.startDate)}</strong> au <strong>{displayDateShort(alert.endDate)}</strong>
                </Typography>
              </Box>
              <ChevronRightIcon fontSize="small" color="action" />
            </Box>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              disabled={busyId === alert.reservationId}
              onClick={() => acknowledge(alert.reservationId)}
              sx={{ minHeight: 44, minWidth: 64, textTransform: 'none' }}
            >
              Vu
            </Button>
          </Box>
        ))}
      </Stack>
    </AttentionCard>
  );
}
