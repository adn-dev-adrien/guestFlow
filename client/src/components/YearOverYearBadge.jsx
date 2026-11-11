/**
 * YearOverYearBadge — « ▲ +12 % vs N-1 · sur 6 mois comparables » from server figures
 * (specs/finance-dashboard-redesign.md rule 20). Renders nothing without a comparison. Generic.
 *
 * Report mode (specs/report-grammar.md rules 3–4) — switched on by `previous` or `showEmpty`:
 * « ↑ +21,3 % (N-1 : 15 210 €) », « ↓ −2,4 pt (N-1 : 55,1 %) » for a rate, and « — vs N-1 » when
 * there is no comparable last year (never « +∞ % »).
 *
 * Props:
 *   change:       number | null   percent (or points with unit 'points'), one decimal, from the server
 *   months?:      number          comparable months
 *   totalMonths?: number          months of the window
 *   previous?:    string          report mode — last year's value, already formatted (« 15 210 € »)
 *   unit?:        'percent' | 'points'   report mode — « % » (default) or « pt » for a rate
 *   better?:      'higher' | 'lower'     report mode — which direction reads as good news (default higher)
 *   showEmpty?:   boolean         report mode — with change null, render « — vs N-1 » instead of nothing
 */
import React from 'react';
import { Box } from '@mui/material';

const fmt = (x) => String(Math.abs(Math.round(x * 10) / 10)).replace('.', ',');
const fmt1 = (x) => Math.abs(Math.round(x * 10) / 10).toFixed(1).replace('.', ',');

const PILL_SX = { display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, px: 1, py: 0.25, borderRadius: 99, whiteSpace: 'nowrap' };

function toneColors(tone) {
  if (tone === 'flat') return { bgcolor: 'neutral.soft', color: 'neutral.text' };
  return tone === 'good' ? { bgcolor: 'success.soft', color: 'success.text' } : { bgcolor: 'error.soft', color: 'error.text' };
}

function ReportBadge({ change, previous, unit = 'percent', better = 'higher' }) {
  if (change == null) {
    return <Box component="span" data-tone="none" sx={{ ...PILL_SX, ...toneColors('flat') }}>— vs N-1</Box>;
  }
  const flat = Math.abs(change) < 0.05;
  const up = change > 0;
  const tone = flat ? 'flat' : (up === (better !== 'lower') ? 'good' : 'bad');
  const suffix = unit === 'points' ? ' pt' : ' %';
  const delta = flat ? `= ${fmt1(0)}${suffix}` : `${up ? '↑ +' : '↓ −'}${fmt1(change)}${suffix}`;
  return (
    <Box
      component="span"
      data-tone={tone}
      sx={{ ...PILL_SX, flexWrap: 'wrap', columnGap: 0.5, whiteSpace: 'normal', fontVariantNumeric: 'tabular-nums', ...toneColors(tone) }}
    >
      <Box component="span" sx={{ whiteSpace: 'nowrap' }}>{delta}</Box>
      {previous != null && <Box component="span" sx={{ whiteSpace: 'nowrap', fontWeight: 500, opacity: 0.85 }}>(N-1 : {previous})</Box>}
    </Box>
  );
}

export default function YearOverYearBadge({ change, months, totalMonths, previous, unit, better, showEmpty = false }) {
  if (previous != null || showEmpty) return <ReportBadge change={change} previous={previous} unit={unit} better={better} />;
  if (change == null) return null;
  const flat = Math.abs(change) < 0.5;
  const up = change > 0;
  const partial = months != null && totalMonths != null && months < totalMonths
    ? ` · sur ${months} mois comparable${months > 1 ? 's' : ''}` : '';
  const text = flat ? `= stable vs N-1${partial}` : `${up ? '▲ +' : '▼ −'}${fmt(change)} % vs N-1${partial}`;
  let colors;
  // Text on a soft background is the palette's `text` shade, never `main` (shell rule 14).
  if (flat) colors = { bgcolor: 'neutral.soft', color: 'neutral.text' };
  else colors = up ? { bgcolor: 'success.soft', color: 'success.text' } : { bgcolor: 'error.soft', color: 'error.text' };
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 600, px: 1, py: 0.25, borderRadius: 99, whiteSpace: 'nowrap', ...colors }}>
      {text}
    </Box>
  );
}
