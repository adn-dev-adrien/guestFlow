/**
 * FormSection — a titled card of a back-office form (the gift-vouchers screens: campaign editor, settings).
 *
 * Props: title, help? (a line under the title), children
 */
import React from 'react';
import {
  Box, Card, CardContent, Stack, Typography,
} from '@mui/material';

export default function FormSection({ title, help, children }) {
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper' }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          <Box>
            <Typography variant="sectionHeader">{title}</Typography>
            {help ? <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{help}</Typography> : null}
          </Box>
          {children}
        </Stack>
      </CardContent>
    </Card>
  );
}
