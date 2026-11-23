/**
 * ReconciliationAlert — the home's « Écarts de règlement » (specs/qonto-bank-reconciliation.md rule 22):
 * the receipts in a gap, one line each with what to fix, a click opens the fiche. Title, count and
 * severity are the server's, drawn by `AttentionCard`. Renders nothing on error: a home card never
 * breaks the page.
 */
import React, { useEffect, useState } from 'react';
import { Divider, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router';
import { api, AttentionCard, ReservationLinkLine } from '../sdk';

export default function ReconciliationAlert({ attention }) {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);

  useEffect(() => {
    let alive = true;
    api.getReconciliation('todo')
      .then((payload) => { if (alive) setItems((payload.items || []).filter((i) => i.isGap)); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  if (items === null) return null;
  return (
    <AttentionCard attention={attention} actions={[{ label: 'Ouvrir le rapprochement', onClick: () => navigate('/finance/rapprochement'), primary: true }]}>
      {items.length > 0 && (
        <Stack divider={<Divider flexItem />} spacing={0.5}>
          {items.slice(0, 8).map((item) => (
            // A sale outside a stay (`reservation.id` null) has no fiche to open.
            <ReservationLinkLine key={item.key} reservationId={item.reservation.id} clientName={item.clientHeading} disabled={item.reservation.id == null}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.clientHeading ? `${item.clientHeading} · ` : ''}{item.label}</Typography>
              <Typography variant="caption" color="text.secondary">{item.fixText || item.stateLabel}</Typography>
            </ReservationLinkLine>
          ))}
        </Stack>
      )}
    </AttentionCard>
  );
}
