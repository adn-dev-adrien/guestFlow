import React from 'react';
import { Tooltip } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import StatusBadge from './StatusBadge';

/**
 * ReservationConflictBadge — warning chip shown when an online full-payment was confirmed onto dates
 * that had become unavailable (specs/public-online-payment.md §3 rule 5 / §6). Renders nothing unless
 * `conflictAt` (the reservation's `bookingConflictAt`) is truthy. Uses the shared soft « Maison »
 * `StatusBadge` (specs/ds-sweep-reservations.md rule 33).
 *
 * Props:
 *   - conflictAt?: string | null   — the reservation's bookingConflictAt timestamp
 */
export default function ReservationConflictBadge({ conflictAt }) {
  if (!conflictAt) return null;
  return (
    <Tooltip title="Paiement en ligne reçu mais ces dates chevauchent une autre réservation — remboursement ou relogement à traiter.">
      <span style={{ display: 'inline-flex' }}>
        <StatusBadge status="error" label="Conflit de dates" icon={<WarningAmberIcon />} />
      </span>
    </Tooltip>
  );
}
