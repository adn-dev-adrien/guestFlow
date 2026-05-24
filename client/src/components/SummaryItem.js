/**
 * SummaryItem — a `label : value` row used inside status/info cards.
 *
 * Props:
 *   label:             string                  (required)
 *   value:             ReactNode | string      (rendered when truthy/non-empty)
 *   valuePlaceholder?: string                  (rendered when value is empty; default '—')
 *
 * Layout: inline on sm+ (label colon-separated from value), stacked on xs.
 */
import React from 'react';
import { Box, Typography } from '@mui/material';

function isEmptyValue(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  return false;
}

export default function SummaryItem({ label, value, valuePlaceholder = '—' }) {
  const empty = isEmptyValue(value);
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        gap: { xs: 0.25, sm: 1.5 },
        py: 0.5,
        alignItems: { xs: 'flex-start', sm: 'baseline' },
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: { sm: 160 }, fontWeight: 500 }}
      >
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          color: empty ? 'text.disabled' : 'text.primary',
          fontStyle: empty ? 'italic' : 'normal',
          wordBreak: 'break-word',
        }}
      >
        {empty ? valuePlaceholder : value}
      </Typography>
    </Box>
  );
}
