/**
 * ExtendDialog, AdjustDialog, ForcedCancelDialog and ResendDialog — the detail actions that take a value (specs/gift-vouchers.md rules 25, 28,
 * specs/gift-voucher-campaigns.md rules 49, 54). The server judges the value; its refusal is shown on the field.
 *
 * Props (all): open, onClose, voucher, onDone(voucher)
 * ForcedCancelDialog also takes `onForced(reason)` — it calls the server with `force` and the mandatory reason and answers by `onDone`.
 */
import React, { useEffect, useState } from 'react';
import { Stack, TextField, Typography } from '@mui/material';
import {
  DateField, FormDialog, useServerToday, useToast,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import { eurosToCents, formatCents, formatDay } from './giftVoucherFormat';
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

/** Rule 54 — after the 14 days a cancellation is a goodwill gesture: the dialog says so and the reason is mandatory (the confirm stays disabled while it is empty). */
export function ForcedCancelDialog({
  open, onClose, voucher, onDone,
}) {
  const { showSuccess } = useToast();
  const D = TEXTS.cancelDialog;
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setReason(''); setError(''); } }, [open]);

  async function submit() {
    setBusy(true);
    try {
      onDone(await giftVouchersApi.cancel(voucher.id, { force: true, reason: reason.trim() }));
      showSuccess(TEXTS.detail.cancelled);
    } catch (err) {
      setError((err && err.message) || 'Le bon n’a pas pu être annulé.');
    } finally {
      setBusy(false);
    }
  }

  const endsOn = voucher.withdrawal ? formatDay(voucher.withdrawal.endsOn) : '';
  const message = voucher.refundCents > 0
    ? D.forcedMessage(voucher.number, endsOn, formatCents(voucher.refundCents))
    : D.forcedMessageOffered(voucher.number, endsOn);
  return (
    <FormDialog
      open={open} onClose={onClose} title={D.forcedTitle} submitLabel={D.forcedConfirm} submitColor="error" onSubmit={submit} submitBusy={busy}
      submitDisabled={!reason.trim()}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography>{message}</Typography>
        <TextField
          label={D.reason} value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} error={Boolean(error)} helperText={error || undefined}
          required fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 200 } }}
        />
      </Stack>
    </FormDialog>
  );
}

/** Rule 49 — « Renvoyer le mail » to the giver's address, or to another typed one. */
export function ResendDialog({
  open, onClose, voucher, onDone,
}) {
  const { showSuccess } = useToast();
  const D = TEXTS.resendDialog;
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setEmail(''); setError(''); } }, [open]);

  async function submit() {
    setBusy(true);
    try {
      onDone(await giftVouchersApi.resend(voucher.id, email.trim()));
      showSuccess(TEXTS.detail.resent);
    } catch (err) {
      setError((err && err.message) || 'Le mail n’est pas parti.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog open={open} onClose={onClose} title={D.title} submitLabel={D.submit} onSubmit={submit} submitBusy={busy}>
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          type="email" label={D.email} value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} error={Boolean(error)}
          helperText={error || (voucher.buyerEmail ? `${D.help} (${voucher.buyerEmail})` : D.help)} fullWidth
        />
      </Stack>
    </FormDialog>
  );
}
