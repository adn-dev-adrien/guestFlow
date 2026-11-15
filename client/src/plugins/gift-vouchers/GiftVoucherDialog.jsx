/**
 * GiftVoucherDialog — « Nouveau bon » (specs/gift-vouchers.md rule 24): a voucher sold outside the site, issued at once.
 * The server judges every field; its refusal is shown on the field it names.
 *
 * Props: open, onClose, onCreated(voucher), paymentMethods ([{ value, label }] — the server's « Payé par » choices)
 */
import React, { useEffect, useState } from 'react';
import { MenuItem, Stack, TextField } from '@mui/material';
import {
  DateField, FormDialog, useServerToday, useToast,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import { eurosToCents } from './giftVoucherFormat';
import { FORM_ERROR_FIELDS, TEXTS } from './giftVoucherTexts';

const EMPTY = {
  amount: '', recipientName: '', senderName: '', message: '', email: '', method: '', date: '',
};
const T = TEXTS.form;

export default function GiftVoucherDialog({
  open, onClose, onCreated, paymentMethods = [],
}) {
  const { showSuccess, showError } = useToast();
  const today = useServerToday();
  const [draft, setDraft] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setDraft(EMPTY); setErrors({}); }
  }, [open]);

  const method = draft.method || (paymentMethods[0] ? paymentMethods[0].value : '');

  const set = (key) => (event) => {
    setDraft((d) => ({ ...d, [key]: event.target.value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  async function submit() {
    const cents = eurosToCents(draft.amount);
    if (cents === null) { setErrors({ amount: 'Un montant en euros est attendu.' }); return; }
    setBusy(true);
    try {
      const created = await giftVouchersApi.create({
        amountCents: cents,
        recipientName: draft.recipientName,
        senderName: draft.senderName,
        message: draft.message,
        email: draft.email,
        paymentMethod: method,
        ...(draft.date ? { date: draft.date } : {}),
      });
      showSuccess(T.created);
      onCreated(created);
    } catch (err) {
      const field = FORM_ERROR_FIELDS[err && err.code];
      if (field) setErrors({ [field]: err.message });
      else showError((err && err.message) || 'Le bon n’a pas pu être créé.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog open={open} onClose={onClose} title={T.title} submitLabel={T.submit} onSubmit={submit} submitBusy={busy}>
      <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField
          label={T.amount} value={draft.amount} onChange={set('amount')} error={Boolean(errors.amount)} helperText={errors.amount}
          required fullWidth slotProps={{ htmlInput: { inputMode: 'decimal' }, input: { endAdornment: '€' } }}
        />
        <TextField label={T.recipient} value={draft.recipientName} onChange={set('recipientName')} fullWidth slotProps={{ htmlInput: { maxLength: 40 } }} />
        <TextField label={T.sender} value={draft.senderName} onChange={set('senderName')} fullWidth slotProps={{ htmlInput: { maxLength: 40 } }} />
        <TextField
          label={T.message} value={draft.message} onChange={set('message')} error={Boolean(errors.message)} helperText={errors.message || `${draft.message.length} / 200`}
          fullWidth multiline minRows={2} slotProps={{ htmlInput: { maxLength: 200 } }}
        />
        <TextField label={T.email} type="email" value={draft.email} onChange={set('email')} error={Boolean(errors.email)} helperText={errors.email} fullWidth />
        <TextField select label={T.method} value={method} onChange={set('method')} error={Boolean(errors.method)} helperText={errors.method} fullWidth>
          {paymentMethods.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
        </TextField>
        <DateField
          label={T.date} value={draft.date || today || ''} onChange={set('date')} error={Boolean(errors.date)} helperText={errors.date}
          fullWidth slotProps={{ htmlInput: { max: today || undefined }, inputLabel: { shrink: true } }}
        />
      </Stack>
    </FormDialog>
  );
}
