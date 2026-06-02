/**
 * LaundryDayCard — pure renderer for the weekly bed-linen summary on PlanningPage
 * (specs/weekly-bed-linen-tracking.md §6.1).
 *
 * Sits under the day header of every laundry-day cell. Two blocks side by side: "À apporter"
 * (sheets used since the previous laundry day) + "À récupérer" (the previous batch coming back
 * from the laundry). Stacks vertically on `xs`.
 *
 * Returns `null` when both sides are zero (rule 13: no visual noise on a quiet week). The
 * server still emits zero-everywhere days uniformly — the silence is a client decision.
 *
 * Props:
 *   data — { dropOff: { singleBeds, doubleBeds, babyBeds }, pickUp: same } from the server.
 *   Pass `undefined` / `null` → renders nothing.
 */
import React from 'react';
import { Card, CardContent, Box, Typography, Stack } from '@mui/material';
import { cyan } from '@mui/material/colors';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';

// Laundry-themed palette (2026-06-02). Cyan reads as "fresh / water / linen" without leaning
// clinical or flashy. Three tones cascade — bg subtle → border just defined enough to pop off
// the page → icon + title saturated enough to draw the eye to the actionable info.
const LAUNDRY_BG = cyan[50];      // #E0F7FA
const LAUNDRY_BORDER = cyan[200]; // #80DEEA
const LAUNDRY_ACCENT = cyan[800]; // #00838F

function totalSheets(side) {
  if (!side) return 0;
  return Number(side.singleBeds || 0) + Number(side.doubleBeds || 0) + Number(side.babyBeds || 0);
}

function formatSide(side) {
  // Returns a human-readable summary: "2 doubles · 1 simple · 3 bébé" — keeps only non-zero
  // segments so the line stays compact. Empty → "—" so the visual symmetry holds with the
  // other side when only one count is non-zero.
  if (!side) return '—';
  const parts = [];
  const dbl = Number(side.doubleBeds || 0);
  const sgl = Number(side.singleBeds || 0);
  const bby = Number(side.babyBeds || 0);
  if (dbl > 0) parts.push(`${dbl} double${dbl > 1 ? 's' : ''}`);
  if (sgl > 0) parts.push(`${sgl} simple${sgl > 1 ? 's' : ''}`);
  if (bby > 0) parts.push(`${bby} bébé`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function SideBlock({ title, side }) {
  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', mt: 0.25 }}>
        {formatSide(side)}
      </Typography>
    </Box>
  );
}

export default function LaundryDayCard({ data }) {
  if (!data) return null;
  const dropTotal = totalSheets(data.dropOff);
  const pickTotal = totalSheets(data.pickUp);
  if (dropTotal === 0 && pickTotal === 0) return null;

  return (
    <Card variant="outlined" sx={{ mb: 1.25, bgcolor: LAUNDRY_BG, borderColor: LAUNDRY_BORDER }}>
      <CardContent sx={{ py: 1.25, px: 2, '&:last-child': { pb: 1.25 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <LocalLaundryServiceIcon fontSize="small" sx={{ color: LAUNDRY_ACCENT }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: LAUNDRY_ACCENT }}>
            Linge à la blanchisserie
          </Typography>
        </Box>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          divider={<Box sx={{ display: { xs: 'none', sm: 'block' }, borderLeft: '1px solid', borderColor: 'divider' }} />}
        >
          <SideBlock title="À apporter" side={data.dropOff} />
          <SideBlock title="À récupérer" side={data.pickUp} />
        </Stack>
      </CardContent>
    </Card>
  );
}
