/**
 * IntakeAlert — Dashboard line for the Gîtes de France booking mails that need the operator
 * (specs/gites-de-france-mail-intake.md rule 14): a mail that could not be read or applied, a booking
 * still without a fiche a day after its mail, or a fiche whose rent is still to choose (amended
 * 2026-10-18). Renders nothing when there is none; title and count are the
 * server's (specs/shell-and-home-day-first.md rule 6).
 */
import React, { useEffect, useState } from 'react';
import { Stack, Typography } from '@mui/material';
import { api, displayDate, AttentionCard, ReservationLinkLine } from '../sdk';

const STATUS_TEXT = {
  pending: 'aucune fiche sur ces dates',
  needs_rent: 'loyer à choisir sur la fiche',
  proposed: 'expéditeur non vérifié',
};

export default function IntakeAlert({ attention }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.getGdfIntakeAlerts().then((r) => setItems((r && r.items) || [])).catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  return (
    <AttentionCard attention={attention}>
      <Stack spacing={0.5}>
        {items.map((item) => (
          <ReservationLinkLine key={item.id} reservationId={item.reservationId} disabled={!item.reservationId}>
            <Typography variant="body2">
              {item.dossierNumber ? `Dossier ${item.dossierNumber}` : 'Mail'} du {displayDate(item.receivedAt.slice(0, 10))} —{' '}
              {item.error || STATUS_TEXT[item.status]}
            </Typography>
          </ReservationLinkLine>
        ))}
      </Stack>
    </AttentionCard>
  );
}
