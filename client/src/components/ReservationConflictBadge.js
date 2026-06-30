import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

/**
 * ReservationConflictBadge — warning chip shown when an online full-payment was confirmed onto dates
 * that had become unavailable (specs/public-online-payment.md §3 rule 5 / §6). Renders nothing unless
 * `conflictAt` (the reservation's `bookingConflictAt`) is truthy.
 *
 * Props:
 *   - conflictAt?: string | null   — the reservation's bookingConflictAt timestamp
 *   - size?: 'small' | 'medium'    — MUI chip size (default 'small')
 *   - sx?: object                  — extra MUI sx
 */
export default function ReservationConflictBadge({ conflictAt, size = 'small', sx }) {
  if (!conflictAt) return null;
  return (
    <Tooltip title="Paiement en ligne reçu mais ces dates chevauchent une autre réservation — remboursement ou relogement à traiter.">
      <Chip
        icon={<WarningAmberIcon />}
        label="Conflit de dates"
        color="error"
        variant="outlined"
        size={size}
        sx={sx}
      />
    </Tooltip>
  );
}
