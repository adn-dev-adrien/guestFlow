/**
 * BookingPaymentFields — the payment of a resource booking, typed with the fiches' own `TenderLines`
 * (specs/resource-booking-pricing-and-invoicing.md rule 11): one line CB of the total by default, the method changed in
 * place, « Ajouter un moyen » for several, the caisse interne switch on a cash line. The server validates the lines
 * with the fiches' rules; this only collects them.
 *
 * Props:
 *   dueCents  number — the amount due (the booking's total; the visit's reste)
 *   value     { tenders, shortfall, canSubmit, gapCents, paidAt, dueCents } | null — `dueCents` is the amount the lines were typed
 *             against, so a screen can tell a payment of the amount on screen from one still on an older amount (loop t24)
 *   whole     boolean (default true) — the amount is paid whole; false on the mini SAS, where a gap is a « Reste à percevoir »
 *   shortfallKinds  ['due'] — passed to `TenderLines` when `whole` is false (specs/outside-booking-sas.md rule 17)
 *   onChange  (next) => void
 *   disabled  boolean
 *   error     string|null — the server's refusal of the payment, shown under the lines
 *
 * By default the amount is paid whole (`whole`): a booking takes one payment of its total, no « Reste à percevoir » nor « Geste
 * commercial » (spec §8, rule 44). The visit's mini SAS lets a gap through as « Reste à percevoir » only (outside-booking-sas rule 17).
 */
import React from 'react';
import { Alert, Box, TextField } from '@mui/material';
import { TenderLines } from '../sdk';
import { localIsoDate } from './localDate';

export default function BookingPaymentFields({
  dueCents, value, onChange, disabled = false, error = null, whole = true, shortfallKinds,
}) {
  const paidAt = (value && value.paidAt) || localIsoDate();
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <TenderLines
        key={dueCents}
        dueCents={dueCents}
        whole={whole}
        shortfallKinds={shortfallKinds}
        initialTenders={[{ method: 'card', amountCents: dueCents, internal: false }]}
        onChange={({
          tenders, shortfall, canSubmit, gapCents, dueCents: answered, live,
        }) => onChange({
          tenders, shortfall, gapCents, canSubmit: whole ? canSubmit && gapCents === 0 : canSubmit, paidAt, dueCents: answered, live,
        })}
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

/**
 * The payment a dialog may commit (loop t25, mixed-method-payments rule 59): the last report only while it answers the due on screen —
 * between a new due and the lines' report for it, the older one (amounts, shortfall) is pending, for the button and the request alike.
 */
export const paymentForDue = (value, dueCents) => (value && value.dueCents === dueCents && (!value.live || value.live()) ? value : null);

/** What the server is told: the lines, or null when nothing is typed. */
export function paymentBody(value) {
  if (!value || !Array.isArray(value.tenders)) return null;
  return { tenders: value.tenders, ...(value.shortfall ? { shortfall: value.shortfall } : {}), paidAt: value.paidAt };
}

export const hasCard = (value) => Boolean(value && Array.isArray(value.tenders) && value.tenders.some((t) => t.method === 'card'));
