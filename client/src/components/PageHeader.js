import React from 'react';
import { Box, Typography, Button } from '@mui/material';

export default function PageHeader({
  title,
  actionLabel,
  actionIcon,
  onAction,
  actionProps,
}) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1.5, mb: 3 }}>
      {/* pageTitle role variant (specs/design-system.md §3.2) — same rendering as PageActionBar titles. */}
      <Typography variant="pageTitle">{title}</Typography>
      {actionLabel && onAction && (
        <Button
          variant="contained"
          startIcon={actionIcon}
          onClick={onAction}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
          {...actionProps}
        >
          {actionLabel}
        </Button>
      )}
    </Box>
  );
}
