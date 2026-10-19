/**
 * YearOverYearBadge — « ▲ +12 % vs N-1 · sur 6 mois comparables » from server figures
 * (specs/finance-dashboard-redesign.md rule 20). Renders nothing without a comparison. Generic.
 *
 * Props:
 *   change:       number | null   percent, one decimal, from the server
 *   months?:      number          comparable months
 *   totalMonths?: number          months of the window
 *   onDark?:      boolean         white variant for a dark background
 */
import React from 'react';
import { Box } from '@mui/material';

const fmt = (x) => String(Math.abs(Math.round(x * 10) / 10)).replace('.', ',');

export default function YearOverYearBadge({ change, months, totalMonths, onDark = false }) {
  if (change == null) return null;
  const flat = Math.abs(change) < 0.5;
  const up = change > 0;
  const partial = months != null && totalMonths != null && months < totalMonths
    ? ` · sur ${months} mois comparable${months > 1 ? 's' : ''}` : '';
  const text = flat ? `= stable vs N-1${partial}` : `${up ? '▲ +' : '▼ −'}${fmt(change)} % vs N-1${partial}`;
  let colors;
  if (onDark) colors = { bgcolor: flat || up ? 'rgba(255,255,255,0.18)' : 'rgba(255,130,110,0.3)', color: '#fff' };
  // Text on a soft background is the palette's `text` shade, never `main` (shell rule 14).
  else if (flat) colors = { bgcolor: 'neutral.soft', color: 'neutral.text' };
  else colors = up ? { bgcolor: 'success.soft', color: 'success.text' } : { bgcolor: 'error.soft', color: 'error.text' };
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, px: 1, py: 0.25, borderRadius: 99, whiteSpace: 'nowrap', ...colors }}>
      {text}
    </Box>
  );
}
