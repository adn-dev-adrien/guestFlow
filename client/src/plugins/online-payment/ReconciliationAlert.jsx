/**
 * ReconciliationAlert — the home's « Écarts de règlement » (specs/qonto-bank-reconciliation.md rule 22):
 * the receipts in a gap, one line each with what to fix, a click opens the fiche. Title, count and
 * severity are the server's, drawn by `AttentionCard`. Renders nothing on error: a home card never
 * breaks the page.
 */
import React, { useEffect, useState } from 'react';
import { Box, Divider, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router';
import { api, AttentionCard } from '../sdk';

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
          {items.slice(0, 8).map((item) => {
            // A sale outside a stay (`reservation.id` null) has no fiche to open.
            const to = item.reservation.id == null ? null : `/reservations/${item.reservation.id}`;
            return (
            <Box
              key={item.key}
              {...(to ? {
                role: 'button', tabIndex: 0,
                onClick: () => navigate(to),
                onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') navigate(to); },
              } : {})}
              sx={{ py: 0.75, minHeight: 44, cursor: to ? 'pointer' : 'default' }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.clientHeading ? `${item.clientHeading} · ` : ''}{item.label}</Typography>
              <Typography variant="caption" color="text.secondary">{item.fixText || item.stateLabel}</Typography>
            </Box>
            );
          })}
        </Stack>
      )}
    </AttentionCard>
  );
}
