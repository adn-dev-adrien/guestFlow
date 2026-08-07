import React from 'react';
import { Box } from '@mui/material';

export default function FormRow({ children, gap = 2, sx }) {
  return (
    <Box sx={{ display: 'flex', gap, flexDirection: { xs: 'column', sm: 'row' }, ...sx }}>
      {children}
    </Box>
  );
}
