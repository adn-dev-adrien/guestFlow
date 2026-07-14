/**
 * LoadingState — the one way to render a loading placeholder (specs/ds-components.md §3.1).
 *
 * Props:
 *   variant?: 'spinner' | 'skeleton'   default 'spinner'
 *   rows?:    number                    skeleton row count (default 3)
 *   label?:   string                    optional French caption under the spinner
 *   py?:      number                    vertical padding (spacing units, default 6)
 */
import React from 'react';
import { Box, CircularProgress, Skeleton, Stack, Typography } from '@mui/material';

export default function LoadingState({ variant = 'spinner', rows = 3, label, py = 6 }) {
  if (variant === 'skeleton') {
    return (
      <Stack spacing={1} sx={{ py: 2 }} aria-busy="true">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} variant="rounded" height={40} />
        ))}
      </Stack>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py }} aria-busy="true">
      <CircularProgress />
      {label && <Typography variant="body2" color="text.secondary">{label}</Typography>}
    </Box>
  );
}
