/**
 * DevisValidityChip — which promise a quote still carries, in the fiche's action bar
 * (specs/devis-extras-parity-and-price-lock.md §3 rule 16; specs/ui-review-2026-10-19-operations.md
 * rule 20).
 *
 * The date and the expiry verdict come from the server; the chip only picks the wording — a terser
 * one on a phone. An expired quote is no longer flagged on the PDF the guest receives: the operator is
 * warned here, and the chip IS the save that re-stamps the validity at the current tariffs.
 *
 * Props: { validUntil: 'YYYY-MM-DD', expired: boolean, compact: boolean, onExtend: () => void }
 */
import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import { displayDate } from '../../utils/formatters';

export default function DevisValidityChip({ validUntil, expired, compact = false, onExtend }) {
  if (!validUntil) return null;
  if (expired) {
    return (
      <Tooltip title="Enregistrer prolonge la validité, aux tarifs actuels" describeChild>
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          clickable
          onClick={onExtend}
          label={compact ? 'Prolonger' : 'Périmé · prolonger'}
        />
      </Tooltip>
    );
  }
  return (
    <Chip
      size="small"
      color="info"
      variant="outlined"
      label={`${compact ? 'Valide' : 'Valide jusqu\'au'} ${displayDate(validUntil)}`}
    />
  );
}
