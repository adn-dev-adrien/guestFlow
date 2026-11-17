/**
 * MollieReserveAlert — the home's « Retenue Mollie non reçue »
 * (specs/mollie-rolling-reserve-and-incoming-payments.md rule 13): one line per fiche (the server's `line`, drawn as it comes) whose reserve is past its window
 * without a matching bank credit, the oldest expected date first; a click opens the fiche. Title, count and severity
 * are the server's (the attention subject `mollie-reserve-late`), drawn by `AttentionCard`; the lines are the same
 * server read as the subject (`GET /api/payments/reconciliation/reserve-attention`, one item per fiche), so the card
 * and its count can never disagree. Renders nothing on error: a home card never breaks the page.
 */
import React, { useEffect, useState } from 'react';
import { Box, Divider, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router';
import { api, AttentionCard } from '../sdk';

// A sale outside a stay (`reservationId` null, `saleKey` set) has no fiche: its line is read-only.
const ficheOf = (item) => (item.reservationId == null ? null : `/reservations/${item.reservationId}`);
const keyOf = (item) => (item.reservationId == null ? `sale:${item.saleKey}` : `r${item.reservationId}`);

export default function MollieReserveAlert({ attention }) {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);

  useEffect(() => {
    let alive = true;
    api.getMollieReserveAttention()
      .then((payload) => { if (alive) setItems((payload && payload.items) || []); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  if (items === null) return null;
  return (
    <AttentionCard attention={attention} actions={[{ label: 'Ouvrir le rapprochement', onClick: () => navigate('/finance/rapprochement'), primary: true }]}>
      {items.length > 0 && (
        <Stack divider={<Divider flexItem />} spacing={0.5}>
          {items.slice(0, 8).map((item) => {
            const to = ficheOf(item);
            return (
              <Box
                key={keyOf(item)}
                {...(to ? {
                  role: 'button', tabIndex: 0,
                  onClick: () => navigate(to),
                  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') navigate(to); },
                } : {})}
                sx={{ py: 0.75, minHeight: 44, cursor: to ? 'pointer' : 'default' }}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.line}</Typography>
              </Box>
            );
          })}
        </Stack>
      )}
    </AttentionCard>
  );
}
