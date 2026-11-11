/**
 * DevisValidityChip — which promise a quote still carries, in the fiche's action bar
 * (specs/devis-extras-parity-and-price-lock.md §3 rule 16; specs/ui-review-2026-10-19-operations.md
 * rule 20).
 *
 * The date, the expiry verdict and whether the quote may be re-issued all come from the server; the
 * chip only picks the wording — a terser one on a phone. An expired quote is no longer flagged on the
 * PDF the guest receives: the operator is warned here. Only an expired quote still OPEN
 * (`extendable`) offers « prolonger »; a converted quote shows no chip at all, an accepted one a plain
 * « Périmé ».
 *
 * Props: { validUntil: 'YYYY-MM-DD', expired, extendable, converted, compact, onExtend: () => void }
 */
import React from 'react';
import { Chip, Tooltip } from '@mui/material';
import { displayDate } from '../../utils/formatters';

export default function DevisValidityChip({ validUntil, expired, extendable = false, converted = false, compact = false, onExtend }) {
  if (!validUntil || converted) return null;
  if (expired && extendable) {
    return (
      <Tooltip title="Prolonger la validité, aux tarifs actuels" describeChild>
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
  if (expired) {
    return <Chip size="small" color="warning" variant="outlined" label="Périmé" />;
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
