/**
 * BankTranches — what a card payment leaves still to arrive on the bank, on the reservation fiche
 * (specs/payments/mollie-rolling-reserve-and-incoming-payments.md rules 18-19): the dated tranches under a paid row of
 * the payments ledger (`BankTranches`) and the one-line recap above the ledger (`BankScheduleSummary`).
 * Feature-specific: it reads the server's `row.bankTranches[]` and `ledger.schedule` as they are — every
 * label, amount, date, state and tone is the server's; `ScheduleLines` draws the tranches the way an
 * instalment plan draws its instalments.
 *
 * BankTranches props:
 *   row: the ledger row ({ label, bankTranches?: [{ key, label, amount, state, tone, stateLabel, refs }] })
 * BankScheduleSummary props:
 *   schedule: { text, segments: [{ text, tone: 'default'|'success'|'muted'|'error' }] }
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import ScheduleLines from '../ScheduleLines';
import TransactionRef from '../TransactionRef';
import { formatCurrency } from '../../utils/formatters';

const TONE_COLOR = { default: 'text.primary', success: 'success.text', muted: 'text.secondary', error: 'error.text' };

function trancheLine(tranche) {
  const { refs } = tranche;
  const hasRefs = Boolean(refs && (refs.qonto || refs.mollieSettlement || refs.molliePayment));
  return {
    key: tranche.key,
    label: tranche.label,
    amount: formatCurrency(tranche.amount),
    stateLabel: tranche.stateLabel,
    tone: tranche.tone,
    detail: hasRefs ? (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0 }}>
        <TransactionRef label="Qonto" value={refs.qonto} />
        <TransactionRef label="Lot Mollie" value={refs.mollieSettlement} />
        <TransactionRef label="Paiement Mollie" value={refs.molliePayment} />
      </Box>
    ) : null,
  };
}

export function BankTranches({ row }) {
  if (!row.bankTranches || row.bankTranches.length === 0) return null;
  return <ScheduleLines label={`Versements de ${row.label}`} lines={row.bankTranches.map(trancheLine)} />;
}

export function BankScheduleSummary({ schedule }) {
  if (!schedule || !schedule.segments || schedule.segments.length === 0) return null;
  return (
    <Typography variant="body2" data-testid="bank-schedule" sx={{ mb: 1.5, fontVariantNumeric: 'tabular-nums' }}>
      {schedule.segments.map((segment, index) => (
        <React.Fragment key={segment.text}>
          {index > 0 && <Box component="span" aria-hidden sx={{ color: 'text.secondary' }}>{index === 1 ? ' — ' : ' · '}</Box>}
          <Box component="span" data-tone={segment.tone} sx={{ color: TONE_COLOR[segment.tone] || 'text.primary', fontWeight: segment.tone === 'default' ? 600 : 500 }}>{segment.text}</Box>
        </React.Fragment>
      ))}
    </Typography>
  );
}
