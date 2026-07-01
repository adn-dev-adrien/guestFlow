/**
 * SasWeatherAlertPage — weather-alert page shown inside the arrival check-in SAS, just before the
 * recap (specs/checkin-weather-alerts.md §6). Feature-local: its layout is tied to the SAS page
 * frame. Renders ready-to-display alerts shaped entirely server-side (colour, timing, message,
 * instructions) — the client only lays them out.
 *
 * Props:
 *   alerts: Array<{
 *     phenomenonId, phenomenon, colorLevel, color, startsAt, endsAt, timingLabel, message,
 *     instructions: string[]
 *   }>
 */
import React from 'react';
import { Stack, Box, Typography, Chip } from '@mui/material';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

// Vigilance colour → MUI chip colour + background tint. Only Orange (3) / Red (4) reach this page.
function chipColorFor(level) {
  return Number(level) >= 4 ? 'error' : 'warning';
}
function tintFor(level) {
  return Number(level) >= 4 ? 'rgba(211, 47, 47, 0.08)' : 'rgba(237, 108, 2, 0.08)';
}
function borderFor(level) {
  return Number(level) >= 4 ? 'error.light' : 'warning.light';
}

export default function SasWeatherAlertPage({ alerts = [] }) {
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Une alerte météo est en cours pour le domaine pendant le séjour du client. Merci de l'en
        informer et de rappeler les consignes de sécurité.
      </Typography>

      {alerts.map((a) => (
        <Box
          key={a.phenomenonId}
          sx={{
            p: { xs: 1.5, sm: 2 },
            borderRadius: 2,
            border: '1px solid',
            borderColor: borderFor(a.colorLevel),
            bgcolor: tintFor(a.colorLevel),
          }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 0.75, sm: 1.5 }}
            sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, mb: 1 }}
          >
            <Chip
              icon={<ReportProblemIcon />}
              label={`Vigilance ${a.color}`}
              color={chipColorFor(a.colorLevel)}
              size="small"
              sx={{ fontWeight: 700 }}
            />
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
              {a.phenomenon}
            </Typography>
          </Stack>

          {a.timingLabel && (
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              {a.timingLabel.charAt(0).toUpperCase() + a.timingLabel.slice(1)}
            </Typography>
          )}

          <Typography variant="body2" sx={{ mb: (a.instructions || []).length ? 1 : 0 }}>
            {a.message}
          </Typography>

          {(a.instructions || []).length > 0 && (
            <Stack spacing={0.5}>
              {a.instructions.map((line, i) => (
                <Stack key={i} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <CheckCircleIcon sx={{ fontSize: 18, mt: '2px', color: 'text.secondary' }} />
                  <Typography variant="body2">{line}</Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      ))}
    </Stack>
  );
}
