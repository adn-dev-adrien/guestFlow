/**
 * AuthCard — the centred card of the screens shown before a session exists: login, forgotten
 * password, new password (specs/hosting-h2-account-security.md §4.3).
 *
 * Props: title ('GuestFlow'), subtitle (string), children.
 */
import React from 'react';
import { Box, Card, CardContent, Typography } from '@mui/material';

export default function AuthCard({ title = 'GuestFlow', subtitle, children }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', p: 2 }}>
      <Card variant="outlined" sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="pageTitle" component="h1" sx={{ color: 'primary.main', mb: 1 }}>{title}</Typography>
          {subtitle && <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>{subtitle}</Typography>}
          {children}
        </CardContent>
      </Card>
    </Box>
  );
}
