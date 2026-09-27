/**
 * GateAccessCard — the fiche's « Accès portail » card (specs/gate-access-sowel-connector.md §3.5
 * rule 26).
 *
 * It shows what Sowel reported for this stay: the state, the window, the code and the link — or
 * « Échec » and the reason when the key could not be made. It **does nothing**: every action on a
 * key lives in Sowel.
 *
 * It renders nothing when guestFlow holds no result (stay not listed yet, a role the server keeps
 * out), rather than an empty frame on every fiche.
 *
 * Props:
 *   reservationId: number | null
 *   cardSx, contentSx: forwarded to the Card / CardContent (the fiche's section rhythm)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, Link, Stack, Typography } from '@mui/material';
import StatusBadge from './StatusBadge';
import SummaryItem from './SummaryItem';
import api from '../api';

const STATE_BADGE = {
  live: 'success',
  outside_hours: 'info',
  not_yet: 'info',
  suspended: 'warning',
  revoked: 'neutral',
  ended: 'neutral',
  no_gate: 'warning',
  failed: 'error',
};

export default function GateAccessCard({ reservationId, cardSx, contentSx }) {
  const [card, setCard] = useState(null);

  const load = useCallback(async () => {
    if (!reservationId) { setCard(null); return; }
    try {
      const { card: payload } = await api.getReservationGateAccess(reservationId);
      setCard(payload);
    } catch {
      // A fiche must not break because the gate has nothing to say.
      setCard(null);
    }
  }, [reservationId]);

  useEffect(() => { load(); }, [load]);

  if (!card || !card.configured) return null;

  return (
    <Card variant="outlined" sx={cardSx}>
      <CardContent sx={contentSx}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
          <Typography variant="sectionHeader">Accès portail</Typography>
          <StatusBadge status={STATE_BADGE[card.state] || 'neutral'} label={card.stateLabel} />
        </Stack>

        {card.ok ? (
          <Stack spacing={0.25}>
            {card.code ? (
              <SummaryItem
                label="Code"
                value={(
                  <Typography component="span" variant="kpiValue" sx={{ fontSize: '1.1rem', letterSpacing: 2 }}>
                    {card.code}
                  </Typography>
                )}
              />
            ) : null}
            <SummaryItem label="Validité" value={card.windowLabel} />
            {card.url ? (
              <SummaryItem
                label="Lien du client"
                value={(
                  <Link href={card.url} target="_blank" rel="noopener noreferrer" sx={{ wordBreak: 'break-all' }}>
                    {card.url}
                  </Link>
                )}
              />
            ) : null}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Sowel n&apos;a pas pu {card.action === 'revoke' ? 'révoquer' : 'créer'} la clé : {card.reason}.
          </Typography>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Les actions sur la clé (suspendre, prolonger, régénérer) vivent dans Sowel → Accès partagés.
        </Typography>
      </CardContent>
    </Card>
  );
}
