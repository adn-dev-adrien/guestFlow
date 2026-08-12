/**
 * TariffRecipeRunsAlert — Dashboard notification card for the tariff-recipe horizon task
 * (specs/tariff-recipes/spec.md §3.2 rule 12): a year the scheduled task generated (« à relire »)
 * or a blocking condition it hit. One dismissible row per run; a click navigates to the property's
 * tariff page. Renders nothing when no run is pending, or on fetch error (a dashboard card must
 * never break the page). Mirrors the IcalNewReservationsAlert pattern.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, AlertTitle, Box, Typography, Divider, Stack, IconButton, Tooltip,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import { useNavigate } from 'react-router';
import api from '../api';

export default function TariffRecipeRunsAlert() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const payload = await api.getTariffRecipeRuns();
      setRuns(Array.isArray(payload?.runs) ? payload.runs : []);
    } catch {
      setRuns([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (runs.length === 0) return null;

  const hasBlocking = runs.some((run) => Number(run.blocking) === 1);
  const open = (run) => navigate(`/properties/${run.propertyId}/pricing-seasons`);
  const dismiss = async (event, run) => {
    event.stopPropagation();
    try { await api.dismissTariffRecipeRun(run.id); } catch { /* the refresh below re-syncs */ }
    refresh();
  };

  return (
    <Alert
      severity={hasBlocking ? 'warning' : 'info'}
      variant="outlined"
      sx={{ mb: 3, borderWidth: 2, bgcolor: 'background.paper' }}
      icon={false}
    >
      <AlertTitle sx={{ fontWeight: 700 }}>Calendrier saisonnier</AlertTitle>
      <Stack divider={<Divider flexItem />} spacing={0.5} sx={{ mt: 1 }}>
        {runs.map((run) => (
          <Box
            key={run.id}
            role="button"
            tabIndex={0}
            onClick={() => open(run)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(run); } }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1,
              cursor: 'pointer', borderRadius: 1, px: 1, py: 1, mx: -1,
              minHeight: 44,
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {run.propertyName}
                {Number(run.blocking) === 1 ? ' — extension bloquée' : (run.generatedYear ? ` — ${run.generatedYear} généré` : '')}
              </Typography>
              <Typography variant="body2" color="text.secondary">{run.note}</Typography>
            </Box>
            <Tooltip title="Marquer comme lu">
              <IconButton size="small" onClick={(event) => dismiss(event, run)} aria-label={`Marquer comme lu (${run.propertyName})`}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <ChevronRightIcon fontSize="small" color="action" />
          </Box>
        ))}
      </Stack>
    </Alert>
  );
}
