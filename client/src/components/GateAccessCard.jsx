/**
 * GateAccessCard — the fiche's « Accès portail » card
 * (specs/gate-access-sowel-connector.md §3.4).
 *
 * It shows what the house configured for this stay: the state, the window in force, the code, the
 * number of phones and the last use. It **does nothing**: holding, revoking, extending and
 * regenerating happen in Sowel, the only place where they can be applied — and the only one that
 * would still know how if guestFlow were stopped.
 *
 * It renders nothing when there is no access (no house configured, stay not pushed yet, a role the
 * server keeps out), rather than an empty frame on every fiche.
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
  active: 'success',
  scheduled: 'info',
  suspended: 'warning',
  revoked: 'error',
  ended: 'neutral',
  deleted: 'error',
};

function formatDateTime(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

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
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
          <Typography variant="sectionHeader">Accès portail</Typography>
          <StatusBadge status={STATE_BADGE[card.state] || 'neutral'} label={card.stateLabel} />
        </Stack>

        {card.deleted ? (
          <Typography variant="body2" color="text.secondary">
            L&apos;accès a été supprimé dans Sowel : le client n&apos;a plus de code. Un nouvel accès
            se recrée depuis Sowel → Administration → Accès invités.
          </Typography>
        ) : (
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
            <SummaryItem label="Téléphones" value={String(card.devices)} />
            <SummaryItem
              label="Dernier usage"
              value={card.lastUsedAt ? formatDateTime(card.lastUsedAt) : ''}
              valuePlaceholder="jamais"
            />
            {card.url ? (
              <SummaryItem
                label="Lien du client"
                value={<Link href={card.url} target="_blank" rel="noopener noreferrer">{card.url}</Link>}
              />
            ) : null}
          </Stack>
        )}

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Les actions (suspendre, prolonger, régénérer) vivent dans Sowel → Administration → Accès invités.
        </Typography>
      </CardContent>
    </Card>
  );
}
