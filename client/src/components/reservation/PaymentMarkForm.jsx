/**
 * PaymentMarkForm — the inline form under a ledger row that records a movement
 * (specs/reservation-payment-ledger.md rules 8-9, 26; §6). Never a dialog: the date, prefilled to
 * today; « Caisse interne » on the complements only; on a platform payout, « Virement reçu »
 * prefilled with the expected net, the gap the server words and its one commission button. The server
 * validates and its refusal is shown under the field it names; the form stays open with the typed
 * value. Closing it restores the row exactly.
 *
 * Specific to the reservation fiche (it knows payouts and the caisse interne).
 *
 * Props:
 *   row:         the ledger row (its `action` carries `cash`, `payout: { expected }`, `after`)
 *   today:       `YYYY-MM-DD`
 *   dateLabel:   « Perçu le », « Reçue le », « Rendue le », « Reçu le »
 *   onSubmit:    async ({ date, cash, payout, commission }) → { ok, error?, field? }
 *   onCancel:    () → void
 *   checkPayout: async (payout) → { gapLabel, commissionLabel, commission } — rule 26
 *   formatAmountInput: (number) → « 829,42 »
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { Box, Button, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import DateField from '../DateField';
import { evaluateArithmetic } from '../../utils/arithmetic';

export default function PaymentMarkForm({ row, today, dateLabel, onSubmit, onCancel, checkPayout, formatAmountInput }) {
  const action = row.action || {};
  const payoutMode = Boolean(action.payout);
  const [date, setDate] = useState(today);
  const [cash, setCash] = useState(false);
  const [payout, setPayout] = useState(payoutMode ? formatAmountInput(action.payout.expected) : '');
  const [gap, setGap] = useState(null);
  const [commission, setCommission] = useState(null);
  const [error, setError] = useState({ message: '', field: null });
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!payoutMode || typeof checkPayout !== 'function') return undefined;
    const value = evaluateArithmetic(payout);
    const mine = ++seq.current;
    if (value == null || value <= 0) { setGap(null); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const answer = await checkPayout(Math.round(value * 100) / 100);
        if (mine === seq.current) setGap(answer || null);
      } catch {
        if (mine === seq.current) setGap(null);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payout, payoutMode]);

  const submit = async () => {
    setBusy(true);
    setError({ message: '', field: null });
    const payoutValue = payoutMode ? evaluateArithmetic(payout) : null;
    if (payoutMode && (payoutValue == null || payoutValue <= 0)) {
      setError({ message: 'Virement reçu : montant requis.', field: 'payout' });
      setBusy(false);
      return;
    }
    const res = await onSubmit({
      date, cash, payout: payoutMode ? Math.round(payoutValue * 100) / 100 : null, commission,
    });
    setBusy(false);
    // The refusal goes under the field the server names; a refusal of the whole mark under the form.
    if (res && res.ok === false && res.error) {
      const field = res.field && /Date$/.test(res.field) ? 'date'
        : res.field === 'platformPayoutAmount' ? 'payout' : null;
      setError({ message: res.error, field });
    }
  };

  const messageId = useId();
  const dateError = error.field === 'date' ? error.message : '';
  const formError = error.field == null ? error.message : '';
  return (
    <Box
      component="form"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
      sx={{
        mt: 1.25, p: 1.25, borderRadius: 1.5, bgcolor: 'background.default',
        display: 'grid', gap: 1, gridTemplateColumns: '1fr',
        '@container (min-width: 600px)': { gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', alignItems: 'start' },
        animation: 'ledgerOpen 200ms ease-out',
        '@keyframes ledgerOpen': { from: { opacity: 0, transform: 'translateY(-4px)' }, to: { opacity: 1, transform: 'none' } },
        '@media (prefers-reduced-motion: reduce)': {
          animation: 'ledgerFade 150ms ease-out',
          '@keyframes ledgerFade': { from: { opacity: 0 }, to: { opacity: 1 } },
        },
      }}
    >
      <DateField
        label={dateLabel}
        type="date"
        size="small"
        value={date}
        autoFocus
        onChange={(e) => { setDate(e.target.value); if (error.message) setError({ message: '', field: null }); }}
        error={Boolean(dateError)}
        helperText={dateError || ' '}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      {payoutMode && (
        <TextField
          label="Virement reçu (€)"
          size="small"
          value={payout}
          onChange={(e) => { setPayout(e.target.value); setCommission(null); }}
          error={error.field === 'payout'}
          helperText={error.field === 'payout' ? error.message : ' '}
          autoComplete="off"
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          sx={{ '& input': { fontSize: 16, fontVariantNumeric: 'tabular-nums' } }}
        />
      )}
      {payoutMode && gap && gap.gapLabel && (
        <Box sx={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }} aria-live="polite">
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{gap.gapLabel}</Typography>
          {gap.commissionLabel && (
            <Button
              variant={commission != null ? 'contained' : 'outlined'}
              size="small"
              onClick={() => setCommission(commission != null ? null : gap.commission)}
              sx={{ minHeight: 44, borderRadius: 999, textTransform: 'none' }}
            >
              {gap.commissionLabel}
            </Button>
          )}
        </Box>
      )}
      {action.cash && (
        <FormControlLabel
          control={<Switch checked={cash} onChange={(e) => setCash(e.target.checked)} />}
          label="Caisse interne"
          sx={{ minHeight: 44, m: 0 }}
        />
      )}
      <Typography id={messageId} aria-live="polite" variant="body2" sx={{ gridColumn: '1 / -1', color: 'error.main', fontWeight: 600, '&:empty': { display: 'none' } }}>
        {formError}
      </Typography>
      <Box sx={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        <Button type="submit" variant="contained" disabled={busy || !date} sx={{ minHeight: 44, borderRadius: 999, textTransform: 'none' }}>
          Valider
        </Button>
        <Button variant="text" onClick={onCancel} sx={{ minHeight: 44, textTransform: 'none' }}>Annuler</Button>
      </Box>
    </Box>
  );
}
