/**
 * MailPreview — an email as it will leave: recipient, subject, text. Generic.
 *
 * Props:
 *   to: string       (optional)
 *   subject: string  (required)
 *   body: string     (required; line breaks kept)
 */
import React from 'react';
import { Box, Typography } from '@mui/material';

export default function MailPreview({ to, subject, body }) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, bgcolor: 'background.default' }}>
      {to && <Typography variant="caption" color="text.secondary" component="div">À : {to}</Typography>}
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, overflowWrap: 'anywhere' }}>{subject}</Typography>
      <Typography variant="body2" component="div" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{body}</Typography>
    </Box>
  );
}
