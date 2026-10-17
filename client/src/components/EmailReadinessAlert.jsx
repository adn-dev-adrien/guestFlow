/**
 * EmailReadinessAlert — dashboard card « Emails incomplets » (specs/guest-email-texts-made-simple.md
 * rule 7): shown while something the server found missing concerns a stay within 14 days. Renders
 * nothing otherwise. Clicking opens « Textes des emails », which lists every item.
 */
import React, { useEffect, useState } from 'react';
import { Box, Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material';
import MarkEmailUnreadIcon from '@mui/icons-material/MarkEmailUnread';
import { useNavigate } from 'react-router';
import api from '../api';

export default function EmailReadinessAlert() {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);

  useEffect(() => {
    api.getEmailReadiness().then((r) => setCount(r.soonCount || 0)).catch(() => setCount(0));
  }, []);

  if (!count) return null;
  return (
    <Card sx={{ mb: 3, bgcolor: 'warning.soft', border: '1px solid', borderColor: 'warning.light' }}>
      <CardActionArea onClick={() => navigate('/settings/emails/textes')}>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Box sx={{ color: 'warning.main', display: 'flex' }}><MarkEmailUnreadIcon fontSize="large" /></Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>Emails incomplets</Typography>
              <Typography variant="body2" color="text.secondary">{`${count} point${count > 1 ? 's' : ''} à compléter avant les prochaines arrivées.`}</Typography>
            </Box>
            <Chip label="Compléter" color="warning" sx={{ display: { xs: 'none', sm: 'flex' } }} />
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
