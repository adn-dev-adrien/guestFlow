/**
 * CollectionStatusCell — « what's left to collect at the door » for one reservation
 * (specs/dashboard-collection-alert.md §6).
 *
 * Renders the server-built `operationalCollection` block. Three exclusive visual states:
 *   - ALERT (red, bold): money to collect at the door — the arrival complement on the arrivals
 *     side, the merged « complément de fin de séjour » on the departures side;
 *   - SETTLED (green, bold): every applicable échéance is paid / caisse interne;
 *   - NEUTRAL (secondary): nothing to collect right now, but something is still in flight —
 *     typically a platform that transfers the rental after the stay, which is normal operation
 *     and must NOT read as an alert.
 * The « Réglé par la plateforme » badge makes that last case explicit.
 *
 * The component decides nothing: which buckets apply, their state and the amounts all come from
 * the server (fat backend). It only maps state → color/label and formats the currency.
 *
 * Props:
 *   collection — the reservation's `operationalCollection` payload. Absent (reception-scoped
 *     payload, which never carries finance) → renders nothing.
 *   side — 'arrival' | 'departure'. Picks the sub-block and the alert wording.
 *   variant — 'row' (table cell, default) | 'card' (mobile card: caption type scale, badge on its
 *     own line).
 */

import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import StatusBadge from './StatusBadge';
import { formatCurrency } from '../utils/formatters';

const PART_STATE_LABEL = { ok: 'OK', pending: 'NON', deferred: 'reporté' };

const ALERT_LABEL = {
  arrival: (amount) => `Complément à encaisser ${formatCurrency(amount)}`,
  departure: (amount) => `À encaisser ${formatCurrency(amount)}`,
};

const SETTLED_LABEL = { arrival: 'OK', departure: 'Paiements OK' };

export default function CollectionStatusCell({ collection, side = 'arrival', variant = 'row' }) {
  const status = collection && collection[side];
  if (!status) return null;

  const isCard = variant === 'card';
  const typeVariant = isCard ? 'caption' : 'body2';
  const detail = (status.parts || [])
    .map((p) => `${p.label} ${PART_STATE_LABEL[p.state] || p.state}`)
    .join(' · ');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
      {status.alert && (
        <Typography variant={typeVariant} sx={{ color: 'error.main', fontWeight: 700 }}>
          {ALERT_LABEL[side](status.amountDue)}
        </Typography>
      )}
      {!status.alert && status.settled && (
        <Typography variant={typeVariant} sx={{ color: 'success.main', fontWeight: 700 }}>
          {SETTLED_LABEL[side]}
        </Typography>
      )}
      {detail && !(status.settled && !status.alert) && (
        <Typography variant={typeVariant} sx={{ color: 'text.secondary' }}>
          {detail}
        </Typography>
      )}
      {collection.platformSettled && (
        <Tooltip title={`${collection.platform || 'La plateforme'} verse le montant de la location après le séjour.`}>
          <span>
            <StatusBadge status="info" label="Réglé par la plateforme" />
          </span>
        </Tooltip>
      )}
    </Box>
  );
}
