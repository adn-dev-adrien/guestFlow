/**
 * SasStayPaymentPage — « Séjour à régler » step of the arrival SAS
 * (specs/collect-stay-payment-at-check-in.md §3.2).
 *
 * A last-minute booking arrives unpaid: the whole stay is handed over at the door, so the wizard
 * announces the amount and records how it was settled. Everything shown here is computed server-side
 * (`stayPayment` in the SAS payload) — this page renders it and owns no arithmetic.
 *
 * Props:
 *   stayPayment  { total, deposit: { due }, balance: { due }, channel, platformLabel } — the payload block
 *   value        current settlement mode: 'card' | 'cash' | 'defer' (= « Pas maintenant »)
 *   onChange     (mode) => void
 *   children     the shared PaymentModeButtons element, injected by the dialog
 */

import React from 'react';
import { Stack, Typography, Alert } from '@mui/material';
import { formatCurrency } from '../../utils/formatters';

const MODE_CAPTION = {
  card: 'Encaissé par CB ou chèque.',
  cash: 'Encaissé en caisse interne (hors comptabilité).',
  defer: "Le séjour reste dû (rien n'est encaissé).",
};

export default function SasStayPaymentPage({ stayPayment, value, children }) {
  const stay = stayPayment || {};
  // `collectible` — what is owed, or what this SAS already collected when the wizard is re-opened.
  const depositDue = Number(stay.deposit?.collectible || 0);
  const balanceDue = Number(stay.balance?.collectible || 0);
  // The per-bucket lines only earn their place when BOTH are owed — a lone bucket would just repeat
  // the hero amount underneath itself.
  const showBuckets = depositDue > 0 && balanceDue > 0;

  return (
    <Stack spacing={1.5}>
      {/* On a platform booking the solde is the payout the OTA wires after the stay, not the guest's
          money: say so before showing an amount someone could tick as collected. */}
      {stay.channel === 'platform' && (
        <Alert severity="warning" sx={{ alignItems: 'flex-start' }}>
          Ce solde est versé par la plateforme après le séjour. À n'encaisser que si le client paie sur place.
        </Alert>
      )}
      {/* Centred under the step's big icon, like the « Code portail » page: the amount IS the page. */}
      <Stack spacing={0.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <Typography variant="body1">Séjour à régler :</Typography>
        {/* Amounts never render in serif — kpiValue is the sans, tabular role. */}
        <Typography variant="kpiValue" sx={{ fontSize: { xs: '2rem', sm: '2.6rem' }, lineHeight: 1.1 }}>
          {formatCurrency(stay.total)}
        </Typography>
        {showBuckets && (
          <Stack spacing={0.25} sx={{ alignItems: 'center' }}>
            <Typography variant="body2" color="text.secondary">Acompte : {formatCurrency(depositDue)}</Typography>
            <Typography variant="body2" color="text.secondary">Solde : {formatCurrency(balanceDue)}</Typography>
          </Stack>
        )}
      </Stack>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>Règlement du séjour</Typography>
      {children}
      <Typography variant="body2" color="text.secondary">{MODE_CAPTION[value] || MODE_CAPTION.defer}</Typography>
    </Stack>
  );
}
