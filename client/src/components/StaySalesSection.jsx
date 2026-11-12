/**
 * StaySalesSection — what a stay sold apart from the total being collected (specs/pricing-components.md §3 rule 32).
 *
 * Props: `section` = `{ title, lines: [{ ref, label, totalCents, statusLabel, sourceLabel }], totalCents, dueCents }` as the server serves it
 * (the SAS payload's `staySales`), or null (renders nothing). Every amount is the server's cents and every label its French; nothing is
 * summed here. Lines wrap on a phone; the section is a quiet block, the total keeps its tabular figures.
 */
import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { formatCurrency } from '../utils/formatters';

const euros = (cents) => formatCurrency((Number(cents) || 0) / 100);

export default function StaySalesSection({ section }) {
  if (!section || !Array.isArray(section.lines) || section.lines.length === 0) return null;
  return (
    <Box component="section" aria-label={section.title} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: { xs: 1.25, sm: 1.5 } }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{section.title}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{euros(section.dueCents)}</Typography>
      </Stack>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0 }}>
        {section.lines.map((line) => (
          <Stack component="li" key={line.ref} direction="row" sx={{ justifyContent: 'space-between', gap: 1, py: 0.5 }}>
            <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              {line.label}
              <Typography component="span" variant="caption" color="text.secondary">{` · ${line.statusLabel}`}</Typography>
            </Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{euros(line.totalCents)}</Typography>
          </Stack>
        ))}
      </Box>
    </Box>
  );
}
