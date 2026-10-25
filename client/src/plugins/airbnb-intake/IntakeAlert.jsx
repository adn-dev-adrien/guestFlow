/**
 * IntakeAlert — Dashboard line for the Airbnb booking mails that need the operator
 * (specs/airbnb-mail-intake.md rule 15): a mail that could not be read or applied, or a booking still
 * without a fiche a day after its mail. The server writes each line; renders nothing when there is none.
 */
import React, { useEffect, useState } from 'react';
import { Alert, AlertTitle, Stack, Typography, Link } from '@mui/material';
import { useNavigate } from 'react-router';
import { api } from '../sdk';

export default function IntakeAlert() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.getAirbnbIntakeAlerts().then((r) => setItems((r && r.items) || [])).catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  return (
    <Alert severity="warning" variant="outlined" sx={{ mb: 3, bgcolor: 'background.paper' }}>
      <AlertTitle>Mails Airbnb à vérifier</AlertTitle>
      <Stack spacing={0.5}>
        {items.map((item) => (
          <Typography key={item.id} variant="body2">
            {item.guest || item.code || 'Mail'} du {item.receivedLabel} — {item.text}
            {item.reservationId && (
              <>
                {' · '}
                <Link component="button" variant="body2" onClick={() => navigate(`/reservations/${item.reservationId}`)}>
                  Ouvrir la fiche
                </Link>
              </>
            )}
          </Typography>
        ))}
      </Stack>
    </Alert>
  );
}
