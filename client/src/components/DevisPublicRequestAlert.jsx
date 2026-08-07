/**
 * DevisPublicRequestAlert — dashboard widget surfacing devis created from the public website
 * (booking requests) that are still pending handling (specs/site-booking-notifications.md §3 rule 5).
 * Self-contained: renders NOTHING when there is none, so it disappears once the operator has
 * processed (converted / status-changed / deleted) every site request. Clicking the card opens the
 * Devis list.
 */

import React, { useEffect, useState } from 'react';
import {
  Card, CardActionArea, CardContent, Stack, Typography, Chip, Box,
} from '@mui/material';
import RequestQuoteOutlinedIcon from '@mui/icons-material/RequestQuoteOutlined';
import { useNavigate } from 'react-router';
import api from '../api';

export default function DevisPublicRequestAlert() {
  const navigate = useNavigate();
  const [pending, setPending] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getPendingPublicDevis()
      .then((data) => setPending((data && data.alerts) || []))
      .catch(() => setPending([]))
      .finally(() => setLoaded(true));
  }, []);

  // Render nothing while loading + when empty — disappears as soon as every site request is handled.
  if (!loaded) return null;
  if (pending.length === 0) return null;

  return (
    <Card
      sx={{
        mb: 3,
        bgcolor: 'info.lighter',
        border: '1px solid',
        borderColor: 'info.light',
      }}
    >
      <CardActionArea onClick={() => navigate('/devis')}>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Box sx={{ color: 'info.main', display: 'flex' }}>
              <RequestQuoteOutlinedIcon fontSize="large" />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Demande{pending.length > 1 ? 's' : ''} de devis depuis le site ({pending.length})
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {pending.length} devis reçu{pending.length > 1 ? 's' : ''} via le site web, en attente de traitement.
              </Typography>
            </Box>
            <Chip label="Voir les devis" color="info" />
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
