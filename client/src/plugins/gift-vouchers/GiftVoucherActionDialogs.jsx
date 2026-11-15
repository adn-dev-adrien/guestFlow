/**
 * ExtendDialog and AdjustDialog — the two detail actions that take a value (specs/gift-vouchers.md rules 25, 28).
 * The server judges the value; its refusal is shown on the field.
 *
 * Props (both): open, onClose, voucher, onDone(voucher)
 */
import React, { useEffect, useState } from 'react';
import { Stack, TextField } from '@mui/material';
import {
  DateField, FormDialog, useServerToday, useToast,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import { eurosToCents } from './giftVoucherFormat';
import { TEXTS } from './giftVoucherTexts';

export function ExtendDialog({
  open, onClose, voucher, onDone,
}) {
  const { showSuccess, showError } = useToast();
  const today = useServerToday();
  const [date, setDate] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setDate(''); setError(''); } }, [open]);

  async function submit() {
    if (!date) { setError('Une date est attendue.'); return; }
    setBusy(true);
    try {
      onDone(await giftVouchersApi.extend(voucher.id, date));
      showSuccess(TEXTS.detail.extended);
    } catch (err) {
      setError((err && err.message) || 'La validité n’a pas pu être prolongée.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog open={open} onClose={onClose} title={TEXTS.extendDialog.title} submitLabel={TEXTS.extendDialog.submit} onSubmit={submit} submitBusy={busy}>
      <Stack spacing={2} sx={{ pt: 1 }}>
        <DateField
          label={TEXTS.extendDialog.date} value={date} onChange={(e) => { setDate(e.target.value); setError(''); }}
          error={Boolean(error)} helperText={error} fullWidth slotProps={{ htmlInput: { min: today || undefined }, inputLabel: { shrink: true } }}
        />
      </Stack>
    </FormDialog>
  );
}

export function AdjustDialog({
  open, onClose, voucher, onDone,
}) {
  const { showSuccess, showError } = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setAmount(''); setReason(''); setErrors({}); } }, [open]);

  async function submit() {
    const cents = eurosToCents(amount);
    if (cents === null || cents === 0) { setErrors({ amount: 'Un montant en euros, différent de 0, est attendu.' }); return; }
    if (!reason.trim()) { setErrors({ reason: 'Un motif est demandé.' }); return; }
    setBusy(true);
    try {
      onDone(await giftVouchersApi.adjust(voucher.id, cents, reason.trim()));
      showSuccess(TEXTS.detail.adjusted);
    } catch (err) {
      const message = (err && err.message) || 'Le solde n’a pas pu être corrigé.';
      setErrors(err && err.code === 'REASON_REQUIRED' ? { reason: message } : { amount: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog open={open} onClose={onClose} title={TEXTS.adjustDialog.title} submitLabel={TEXTS.adjustDialog.submit} onSubmit={submit} submitBusy={busy}>
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label={TEXTS.adjustDialog.amount} value={amount} onChange={(e) => { setAmount(e.target.value); setErrors({}); }}
          error={Boolean(errors.amount)} helperText={errors.amount || TEXTS.adjustDialog.amountHelp} required fullWidth
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
        />
        <TextField
          label={TEXTS.adjustDialog.reason} value={reason} onChange={(e) => { setReason(e.target.value); setErrors({}); }}
          error={Boolean(errors.reason)} helperText={errors.reason} required fullWidth slotProps={{ htmlInput: { maxLength: 200 } }}
        />
      </Stack>
    </FormDialog>
  );
}
