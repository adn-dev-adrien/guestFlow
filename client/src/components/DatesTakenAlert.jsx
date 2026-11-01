/**
 * DatesTakenAlert — Dashboard card « Dates prises » (specs/payment-link-lifecycle.md rules 43, 66): the stays whose
 * payment request lost its dates to another stay, with whether the guest was told. Every word comes from the
 * server (GET /api/dashboard/dates-taken): `title`, `notice.label`, `takenBy.label`, `detail`.
 *
 * Self-contained: `attention` is the home's summary of the subject. `takenBy.label` opens the stay that took the dates
 * when it has a `url`; « Ouvrir » opens the stay; « Vu » acknowledges the row on the server and drops it. Renders
 * nothing when the list is empty or the fetch fails.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Divider, Link, Stack, Typography } from '@mui/material';
import { Link as RouterLink, useNavigate } from 'react-router';
import api from '../api';
import AttentionCard from './AttentionCard';
import StatusBadge from './StatusBadge';
import { touchHitArea } from '../utils/touchHitArea';

export default function DatesTakenAlert({ attention }) {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getDatesTakenAlerts();
      setAlerts(Array.isArray(payload?.alerts) ? payload.alerts : []);
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const acknowledge = async (id) => {
    setBusyId(id);
    try {
      await api.acknowledgeDatesTaken(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  if (alerts.length === 0) return null;

  return (
    <AttentionCard attention={attention}>
      <Stack divider={<Divider flexItem />} spacing={1}>
        {alerts.map((alert) => (
          <Box key={alert.id} sx={{ py: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: '1 1 14rem', minWidth: 0, overflowWrap: 'anywhere' }}>
                {alert.title}
              </Typography>
              <StatusBadge status={alert.notice?.sent ? 'success' : 'warning'} label={alert.notice?.label} />
            </Box>
            {alert.takenBy?.label && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
                {alert.takenBy.url ? (
                  <Link component={RouterLink} to={alert.takenBy.url} color="inherit" underline="always" sx={touchHitArea}>
                    {alert.takenBy.label}
                  </Link>
                ) : alert.takenBy.label}
              </Typography>
            )}
            {alert.detail && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>
                {alert.detail}
              </Typography>
            )}
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => navigate(alert.url)}
                sx={{ minHeight: 44, minWidth: 64, textTransform: 'none' }}
              >
                Ouvrir
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                disabled={busyId === alert.id}
                onClick={() => acknowledge(alert.id)}
                aria-label={`Vu : ${alert.title}`}
                sx={{ minHeight: 44, minWidth: 64, textTransform: 'none' }}
              >
                Vu
              </Button>
            </Stack>
          </Box>
        ))}
      </Stack>
    </AttentionCard>
  );
}
