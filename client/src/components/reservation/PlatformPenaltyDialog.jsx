/**
 * PlatformPenaltyDialog — « Pénalité plateforme » (specs/reconciliation-assisted-matching.md rules 24–26, 29).
 * An amount a platform kept on a payout besides its commission: amount, motif, date, and — only when the
 * server needs it — whether the payout typed on the fiche is the statement figure or the bank amount. The
 * server previews both figures and refuses in words; nothing is computed here.
 *
 * Props: open, onClose, reservationId, source ('fiche' | 'reconciliation'), initialAmount? (euros, prefilled
 *        from a reconciliation gap), onDone() — called after the penalty is stored
 */
import React, { useEffect, useState } from 'react';
import {
  Autocomplete, Box, FormControlLabel, Radio, RadioGroup, TextField, Typography,
} from '@mui/material';
import api from '../../api';
import FormDialog from '../FormDialog';
import useLatestPreview from '../../hooks/useLatestPreview';
import { useToast } from '../DialogProvider';
import { formatCurrency } from '../../utils/formatters';

const toAmount = (text) => {
  const v = String(text ?? '').replace(/[\s€]/g, '').replace(',', '.');
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : null;
};
const asInput = (n) => (n == null ? '' : String(n).replace('.', ','));

export default function PlatformPenaltyDialog({ open, onClose, reservationId, source = 'fiche', initialAmount = null, onDone }) {
  const { showError, showSuccess } = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [date, setDate] = useState('');
  const [choice, setChoice] = useState(null);
  const [touched, setTouched] = useState({});
  const [suggestions, setSuggestions] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(asInput(initialAmount)); setReason(''); setDate(''); setChoice(null); setTouched(initialAmount != null ? { amount: true } : {});
    api.listPlatformPenalties(reservationId).then((r) => setSuggestions(r.suggestions || [])).catch(() => setSuggestions([]));
  }, [open, reservationId, initialAmount]);

  const body = {
    amount: toAmount(amount), reason, source, ...(date ? { date } : {}), ...(choice == null ? {} : { payoutIncludesPenalty: choice }),
  };
  const preview = useLatestPreview({
    fetcher: (d) => api.previewPlatformPenalty(reservationId, d.body),
    draft: { body },
    enabled: open && toAmount(amount) != null && toAmount(amount) > 0,
    scope: reservationId,
    resetKey: open ? String(reservationId) : 'closed',
    delay: 250,
  });
  const shown = preview.data;
  const answer = preview.fresh ? preview.data : null;
  const refused = (shown ? shown.errors : []).filter((e) => e.field !== 'payoutIncludesPenalty' && touched[e.field]);

  const submit = async () => {
    setBusy(true);
    try {
      await api.declarePlatformPenalty(reservationId, body);
      showSuccess('Pénalité enregistrée.');
      if (onDone) await onDone();
      onClose();
    } catch (err) {
      showError(err?.message || 'Enregistrement impossible.');
    } finally { setBusy(false); }
  };

  const touch = (field) => setTouched((t) => ({ ...t, [field]: true }));
  const amountInvalid = amount.trim() !== '' && toAmount(amount) == null;
  const errorOf = (field) => (field === 'amount' && amountInvalid ? { message: 'Montant invalide : chiffres et virgule, deux décimales au plus.' } : refused.find((e) => e.field === field));
  const figures = (label, key, fmt) => (shown && shown.before && shown.after && shown.before[key] != null && shown.after[key] != null
    ? `${label} ${fmt(shown.before[key])} → ${fmt(shown.after[key])}` : null);

  return (
    <FormDialog
      open={open} onClose={onClose} title="Pénalité plateforme" submitLabel="Enregistrer" onSubmit={submit} submitBusy={busy}
      submitDisabled={!answer || !answer.valid || amountInvalid}
    >
      <TextField
        fullWidth label="Montant (€)" value={amount} sx={{ mt: 1 }} onChange={(e) => { setAmount(e.target.value); touch('amount'); }}
        error={Boolean(errorOf('amount'))} helperText={errorOf('amount')?.message || ' '}
        slotProps={{ htmlInput: { inputMode: 'decimal', autoComplete: 'off', style: { fontSize: 16 } } }}
      />
      <Autocomplete
        freeSolo openOnFocus options={suggestions} inputValue={reason} onInputChange={(_e, v) => { setReason(v); touch('reason'); }}
        renderInput={(params) => (
          <TextField {...params} label="Motif" error={Boolean(errorOf('reason'))} helperText={errorOf('reason')?.message || ' '} slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, style: { fontSize: 16 } } }} />
        )}
      />
      <TextField
        fullWidth type="date" label="Date" value={date} onChange={(e) => { setDate(e.target.value); touch('date'); }}
        slotProps={{ inputLabel: { shrink: true } }} error={Boolean(errorOf('date'))}
        helperText={errorOf('date')?.message || 'Par défaut : la date de réception du versement, sinon aujourd’hui.'}
      />
      {shown && (shown.needsChoice || choice != null) && (
        <Box sx={{ mt: 1.5 }}>
          <Typography id="penalty-choice" variant="body2" sx={{ fontWeight: 600 }}>
            Le versement saisi ({shown.before.payout != null ? formatCurrency(shown.before.payout) : ''}) est :
          </Typography>
          <RadioGroup aria-labelledby="penalty-choice" value={choice == null ? '' : String(choice)} onChange={(e) => setChoice(e.target.value === 'true')}>
            <FormControlLabel value="false" control={<Radio />} label="le montant du relevé, avant pénalité" />
            <FormControlLabel value="true" control={<Radio />} label="le montant reçu sur le compte, pénalité déjà déduite" />
          </RadioGroup>
        </Box>
      )}
      {shown && shown.before && (
        <Box sx={{ mt: 1.5, p: 1.25, borderRadius: 1.5, bgcolor: 'background.default' }} aria-live="polite">
          {[figures('Commission', 'commission', formatCurrency), figures('Versement attendu', 'netReceived', formatCurrency)].filter(Boolean).map((line) => (
            <Typography key={line} variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{line}</Typography>
          ))}
        </Box>
      )}
      {shown && shown.warnings.map((w) => (
        <Typography key={w} variant="caption" component="div" sx={{ mt: 1, px: 1.25, py: 0.75, borderRadius: 1, bgcolor: 'warning.soft', color: 'warning.text' }}>{w}</Typography>
      ))}
      {shown && shown.errors.filter((e) => !['amount', 'reason', 'date', 'payoutIncludesPenalty'].includes(e.field)).map((e) => (
        <Typography key={e.code} variant="caption" component="div" color="error.main" role="alert" sx={{ mt: 1 }}>{e.message}</Typography>
      ))}
    </FormDialog>
  );
}
