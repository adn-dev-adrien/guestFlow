/**
 * MollieReserveAlert — the home's « Retenue Mollie non reçue »
 * (specs/mollie-rolling-reserve-and-incoming-payments.md rule 13): one line per fiche whose reserve is past its window
 * without a matching bank credit, with the expected date; a click opens the fiche. Title, count and severity are the
 * server's (the attention subject `mollie-reserve-late`), drawn by `AttentionCard`. The lines are the reconciliation's
 * own late reserve receipts, as the server worded them. Renders nothing on error: a home card never breaks the page.
 */
import React, { useEffect, useState } from 'react';
import { Box, Divider, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router';
import { api, AttentionCard } from '../sdk';
import { money } from './reconciliationShared';

export default function MollieReserveAlert({ attention }) {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);

  useEffect(() => {
    let alive = true;
    api.getReconciliation('todo')
      .then((payload) => { if (alive) setItems((payload.items || []).filter((i) => i.mollie && i.mollie.tranche === 'retenue' && i.state === 'late')); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  if (items === null) return null;
  return (
    <AttentionCard attention={attention} actions={[{ label: 'Ouvrir le rapprochement', onClick: () => navigate('/finance/rapprochement'), primary: true }]}>
      {items.length > 0 && (
        <Stack divider={<Divider flexItem />} spacing={0.5}>
          {items.slice(0, 8).map((item) => (
            <Box
              key={item.key} role="button" tabIndex={0}
              onClick={() => navigate(`/reservations/${item.reservation.id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/reservations/${item.reservation.id}`); }}
              sx={{ py: 0.75, cursor: 'pointer', minHeight: 44 }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.reservation.clientName || 'Client'} · {money(item.expectedCents)}</Typography>
              <Typography variant="caption" color="text.secondary">{item.fixText || `${item.label} · attendue vers le ${item.mollie.expectedDateLabel}`}</Typography>
            </Box>
          ))}
        </Stack>
      )}
    </AttentionCard>
  );
}
