/**
 * BookingPaymentFields — the payment of a resource booking, typed with the fiches' own `TenderLines`
 * (specs/resource-booking-pricing-and-invoicing.md rule 11): one line CB of the total by default, the method changed in
 * place, « Ajouter un moyen » for several, the caisse interne switch on a cash line. The server validates the lines
 * with the fiches' rules; this only collects them.
 *
 * Props:
 *   dueCents  number — the booking's total
 *   value     { tenders, canSubmit, paidAt } | null
 *   onChange  (next) => void
 *   disabled  boolean
 *   error     string|null — the server's refusal of the payment, shown under the lines
 *
 * The amount is paid whole (`whole`): a booking takes one payment of its total, no « Reste à percevoir » nor « Geste
 * commercial » (spec §8, rule 44).
 */
import React from 'react';
import { Alert, Box, TextField } from '@mui/material';
import { TenderLines } from '../sdk';
import { localIsoDate } from './localDate';

export default function BookingPaymentFields({ dueCents, value, onChange, disabled = false, error = null }) {
  const paidAt = (value && value.paidAt) || localIsoDate();
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <TenderLines
        key={dueCents}
        dueCents={dueCents}
        whole
        initialTenders={[{ method: 'card', amountCents: dueCents, internal: false }]}
        onChange={({ tenders, canSubmit, gapCents }) => onChange({ tenders, canSubmit: canSubmit && gapCents === 0, paidAt })}
        disabled={disabled}
      />
      <TextField
        label="Date du paiement"
        type="date"
        size="small"
        value={paidAt}
        onChange={(e) => onChange({ ...(value || {}), paidAt: e.target.value })}
        disabled={disabled}
        sx={{ maxWidth: 220 }}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      {error && <Alert severity="error">{error}</Alert>}
    </Box>
  );
}

/** What the server is told: the lines, or null when nothing is typed. */
export function paymentBody(value) {
  if (!value || !Array.isArray(value.tenders)) return null;
  return { tenders: value.tenders, paidAt: value.paidAt };
}

/** Rule 13 — an invoice is offered on a payment entirely on the books. */
export const allOnTheBooks = (value) => Boolean(value && Array.isArray(value.tenders) && value.tenders.length > 0 && value.tenders.every((t) => !t.internal));
export const hasCard = (value) => Boolean(value && Array.isArray(value.tenders) && value.tenders.some((t) => t.method === 'card'));
