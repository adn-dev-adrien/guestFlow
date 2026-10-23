/**
 * LinkTransactionDialog — manual linking of a credit to an échéance (specs/qonto-bank-reconciliation.md
 * rules 12, 18). Two entries, one dialog:
 *   - from a receipt (the fiche's card): `receipts` = that fiche's lines, `credits` = the account's open credits;
 *   - from a credit (the page): `credit` is fixed, `receipts` = the candidates the server listed.
 * The amount field starts on what the server says is open and refuses, inline, anything that is not an
 * amount or that exceeds what the credit has left; the server re-checks (ALLOCATION_EXCEEDS_TRANSACTION).
 *
 * Props: open, onClose, receipts[{key, reservationId, ledgerKey, label, expectedCents, clientName?}],
 *        credits[{transactionId, remainingCents, dateLabel, counterparty, reference}], credit?, receipt?,
 *        busy, onSubmit({ transactionId, reservationId, ledgerKey, amountCents })
 */
import React, { useEffect, useMemo, useState } from 'react';
import { FormControl, FormControlLabel, FormLabel, MenuItem, Radio, RadioGroup, TextField, Typography } from '@mui/material';
import { FormDialog } from '../sdk';
import { money, parseEuroInput, centsToInput } from './reconciliationShared';

export default function LinkTransactionDialog({ open, onClose, receipts = [], credits = [], credit = null, receipt = null, busy = false, onSubmit }) {
  const [txId, setTxId] = useState('');
  const [receiptKey, setReceiptKey] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  const creditList = useMemo(() => (credit ? [credit] : credits), [credit, credits]);
  const receiptList = useMemo(() => (receipt ? [receipt] : receipts), [receipt, receipts]);

  useEffect(() => {
    if (!open) return;
    const firstTx = credit ? credit.transactionId : (creditList[0] && creditList[0].transactionId) || '';
    const firstReceipt = receipt ? receipt.key : (receiptList[0] && receiptList[0].key) || '';
    setTxId(firstTx);
    setReceiptKey(firstReceipt);
    setError('');
  }, [open, credit, receipt, creditList, receiptList]);

  const picked = creditList.find((c) => c.transactionId === txId);
  const target = receiptList.find((r) => r.key === receiptKey);

  useEffect(() => {
    if (!picked || !target) { setAmount(''); return; }
    setAmount(centsToInput(Math.min(picked.remainingCents, target.expectedCents)));
    setError('');
  }, [picked, target]);

  const submit = () => {
    const cents = parseEuroInput(amount);
    if (cents == null) { setError('Montant invalide : chiffres et virgule seulement (ex. 120,50).'); return; }
    if (cents <= 0) { setError('Le montant doit être supérieur à 0.'); return; }
    if (picked && cents > picked.remainingCents) { setError(`Le virement n'a plus que ${money(picked.remainingCents)} à répartir.`); return; }
    onSubmit({ transactionId: txId, reservationId: target.reservationId, ledgerKey: target.ledgerKey, amountCents: cents });
  };

  const empty = creditList.length === 0 || receiptList.length === 0;
  return (
    <FormDialog open={open} onClose={onClose} title="Rattacher un virement" submitLabel="Rattacher" onSubmit={submit} submitDisabled={empty} submitBusy={busy}>
      {empty ? (
        <Typography variant="body2" color="text.secondary">
          {creditList.length === 0 ? 'Aucun virement disponible : tous les crédits lus sont déjà rattachés.' : 'Aucune échéance à rattacher.'}
        </Typography>
      ) : (
        <>
          {!credit && (
            <FormControl sx={{ mt: 1 }}>
              <FormLabel>Virements du compte encore disponibles</FormLabel>
              <RadioGroup value={txId} onChange={(e) => setTxId(e.target.value)}>
                {creditList.map((c) => (
                  <FormControlLabel
                    key={c.transactionId}
                    value={c.transactionId}
                    control={<Radio />}
                    sx={{ alignItems: 'flex-start', my: 0.5 }}
                    label={(
                      <span>
                        <b style={{ fontVariantNumeric: 'tabular-nums' }}>{money(c.remainingCents)}</b> · {c.dateLabel}<br />
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                          {c.counterparty}{c.reference ? ` · « ${c.reference} »` : ''}
                        </Typography>
                      </span>
                    )}
                  />
                ))}
              </RadioGroup>
            </FormControl>
          )}
          {credit && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              <b>{money(credit.remainingCents)}</b> · {credit.dateLabel} · {credit.counterparty}
            </Typography>
          )}
          <TextField
            select fullWidth label="Échéance" value={receiptKey} onChange={(e) => setReceiptKey(e.target.value)}
            disabled={Boolean(receipt)} sx={{ mt: 2 }}
          >
            {receiptList.map((r) => (
              <MenuItem key={r.key} value={r.key}>{r.clientName ? `${r.clientName} · ` : ''}{r.label} · {money(r.expectedCents)}</MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth label="Montant rattaché (€)" value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }}
            slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off', style: { fontSize: 16 } } }}
            error={Boolean(error)} helperText={error || 'Par défaut, le reste à répartir du virement et de l\'échéance.'} sx={{ mt: 2 }}
          />
        </>
      )}
    </FormDialog>
  );
}
