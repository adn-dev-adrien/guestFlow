/**
 * KeyValues — a « label : value » list for a summary card; two columns on sm+, stacked on xs.
 * Generic.
 *
 * Props:
 *   items: [{ label: string, value: ReactNode }]  (required; falsy values are skipped)
 */
import React from 'react';
import { Box, Typography } from '@mui/material';

export default function KeyValues({ items }) {
  return (
    <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'max-content minmax(0,1fr)' }, columnGap: 2, rowGap: { xs: 0.25, sm: 0.75 } }}>
      {items.filter((i) => i.value !== null && i.value !== undefined && i.value !== '').map((i) => (
        <React.Fragment key={i.label}>
          <Typography component="dt" variant="body2" color="text.secondary" sx={{ mt: { xs: 1, sm: 0 } }}>{i.label}</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>{i.value}</Typography>
        </React.Fragment>
      ))}
    </Box>
  );
}
