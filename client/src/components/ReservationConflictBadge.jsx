import React from 'react';
import { Tooltip } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import StatusBadge from './StatusBadge';

/**
 * ReservationConflictBadge — warning chip shown when a stay landed on dates another reservation holds:
 * an online full-payment confirmed onto dates that had become unavailable (specs/public-online-payment.md
 * §3 rule 5 / §6), or a platform feed announcing an overlapping stay (specs/ical-import-hardening.md
 * rule 3). Renders nothing unless
 * `conflictAt` (the reservation's `bookingConflictAt`) is truthy. Uses the shared soft « Maison »
 * `StatusBadge` (specs/ds-sweep-reservations.md rule 33).
 *
 * Props:
 *   - conflictAt?: string | null   — the reservation's bookingConflictAt timestamp
 */
export default function ReservationConflictBadge({ conflictAt }) {
  if (!conflictAt) return null;
  return (
    <Tooltip title="Ces dates chevauchent une autre réservation : doublon à supprimer, remboursement ou relogement.">
      <span style={{ display: 'inline-flex' }}>
        <StatusBadge status="error" label="Conflit de dates" icon={<WarningAmberIcon />} />
      </span>
    </Tooltip>
  );
}
