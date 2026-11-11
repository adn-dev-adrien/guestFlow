/**
 * SplitSharesDialog — « Répartir et confirmer » a grouped platform payout whose shares are only estimated
 * (specs/reconciliation-assisted-matching.md rules 18–19). One field per stay, prefilled with the estimate;
 * the server previews the sum and refuses (SHARES_DO_NOT_SUM) until the shares make the credit to the
 * cent. Each confirmed share becomes that fiche's payout.
 *
 * Props: open, onClose, busy, proposal ({ id, pairs, bank }), labels ({ [reservationId|ledgerKey]: string }),
 *        onSubmit({ pairs, proposalId })
 */
import React, { useEffect, useState } from 'react';
import { Typography } from '@mui/material';
import { api, FormDialog, useLatestPreview } from '../sdk';
import AmountPairFields from './AmountPairFields';
import { money, parseEuroInput, centsToInput } from './reconciliationShared';

export default function SplitSharesDialog({ open, onClose, busy = false, proposal, labels = {}, onSubmit }) {
  const [shares, setShares] = useState([]);
  useEffect(() => {
    if (open && proposal) setShares(proposal.pairs.map((p) => ({ ...p, text: centsToInput(p.amountCents) })));
  }, [open, proposal]);

  const pairs = shares.map((s) => ({ transactionId: s.transactionId, reservationId: s.reservationId, ledgerKey: s.ledgerKey, amountCents: parseEuroInput(s.text) }));
  const invalid = pairs.some((p) => p.amountCents == null);
  const preview = useLatestPreview({
    fetcher: (d) => api.previewReconciliationAllocation({ pairs: d.pairs, proposalId: proposal.id }),
    draft: { pairs },
    enabled: open && Boolean(proposal) && shares.length > 0 && !invalid,
    scope: proposal ? proposal.id : null,
    resetKey: open && proposal ? proposal.id : 'closed',
    delay: 150,
  });
  const answer = preview.fresh ? preview.data : null;
  const shown = preview.data;

  return (
    <FormDialog
      open={open} onClose={onClose} maxWidth="xs" title="Répartir le versement" submitLabel="Répartir et confirmer"
      submitDisabled={!answer || !answer.valid || invalid} submitBusy={busy} onSubmit={() => onSubmit({ pairs, proposalId: proposal.id })}
    >
      {proposal && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Versement de <b>{money(proposal.bank.amountCents)}</b> du {proposal.bank.dateLabel} : les montants sont estimés, saisir la part de chaque séjour.
        </Typography>
      )}
      <AmountPairFields
        pairs={shares.map((s) => ({ id: `${s.reservationId}|${s.ledgerKey}`, label: labels[`${s.reservationId}|${s.ledgerKey}`] || s.ledgerKey, text: s.text }))}
        onChange={(i, text) => setShares((cur) => cur.map((x, j) => (j === i ? { ...x, text } : x)))}
      />
      {shown && shown.errors.map((e) => (
        <Typography key={`${e.code}-${e.field}`} variant="caption" component="div" color="error.main" role="alert">{e.message}</Typography>
      ))}
    </FormDialog>
  );
}
