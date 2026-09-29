/**
 * RankedBarList — a « top N » ranking: one line per item with its label, its value on the right and a
 * proportional bar underneath (specs/finance-exercise-overview-charts.md). Generic: the ranking, the
 * values and the bar ratios come ready-made from the caller's payload; this component only draws them.
 *
 * Props:
 *   items:         Array<{ key, label, value, ratio }>   ratio in [0, 1], relative to the longest bar
 *   formatValue?:  (value) => string                     default: the value as is
 *   emptyMessage?: string                                shown through EmptyState when items is empty
 *   color?:        string                                bar color (MUI palette path), default primary.main
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import EmptyState from './EmptyState';

export default function RankedBarList({ items, formatValue = (v) => v, emptyMessage = 'Aucune donnée.', color = 'primary.main' }) {
  if (!items || items.length === 0) return <EmptyState message={emptyMessage} py={3} />;
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {items.map((item) => (
        <Box component="li" key={item.key} sx={{ mb: 1.5, '&:last-child': { mb: 0 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            <Typography variant="body2" noWrap>{item.label}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {formatValue(item.value)}
            </Typography>
          </Box>
          <Box sx={{ height: 8, mt: 0.5, borderRadius: 4, bgcolor: 'action.hover', overflow: 'hidden' }}>
            <Box sx={{ height: '100%', width: `${Math.max(0, Math.min(1, item.ratio)) * 100}%`, bgcolor: color, borderRadius: 4 }} />
          </Box>
        </Box>
      ))}
    </Box>
  );
}
