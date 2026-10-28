/**
 * BulkConfirmDialog — « Tout confirmer » (specs/reconciliation-assisted-matching.md rules 12–13). States
 * what will be written from the server's `bulk` summary; « à vérifier » proposals are left out unless the
 * checkbox is ticked, which only switches between two server-computed sets.
 *
 * Props: open, onClose, bulk ({ proposalIds, count, totalCents, amounts, toVerify: same shape }), busy,
 *        onConfirm({ proposalIds, amounts })
 */
import React, { useEffect, useState } from 'react';
import { Checkbox, FormControlLabel, Typography } from '@mui/material';
import { FormDialog } from '../sdk';
import { money } from './reconciliationShared';

export default function BulkConfirmDialog({ open, onClose, bulk, busy = false, onConfirm }) {
  const [withVerify, setWithVerify] = useState(false);
  useEffect(() => { if (open) setWithVerify(false); }, [open]);
  if (!bulk) return null;

  const { toVerify } = bulk;
  const count = bulk.count + (withVerify ? toVerify.count : 0);
  const total = bulk.totalCents + (withVerify ? toVerify.totalCents : 0);
  const send = () => onConfirm({
    proposalIds: [...bulk.proposalIds, ...(withVerify ? toVerify.proposalIds : [])],
    amounts: { ...bulk.amounts, ...(withVerify ? toVerify.amounts : {}) },
  });

  return (
    <FormDialog
      open={open} onClose={onClose} title="Tout confirmer" submitLabel={`Confirmer ${count}`} onSubmit={send}
      submitDisabled={count === 0} submitBusy={busy} maxWidth="xs"
    >
      <Typography variant="h5" component="p" sx={{ fontVariantNumeric: 'tabular-nums', mt: 0.5 }} aria-live="polite">
        {count} rapprochement{count > 1 ? 's' : ''} · {money(total)}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        Les fiches seront marquées reçues à la date du virement.
      </Typography>
      {toVerify.count > 0 && (
        <FormControlLabel
          sx={{ mt: 1, minHeight: 44 }}
          control={<Checkbox checked={withVerify} onChange={(e) => setWithVerify(e.target.checked)} />}
          label={`Inclure aussi les ${toVerify.count} à vérifier (${money(toVerify.totalCents)})`}
        />
      )}
    </FormDialog>
  );
}
