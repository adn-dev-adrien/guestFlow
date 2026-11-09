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
 *   methods:     optional `[{ value, label }]` — asks HOW it was received (an installment: virement, chèque…);
 *                the choice rides `onSubmit({ …, method })`. Absent on the other ledger rows.
 *   onSubmit:    async ({ date, cash, payout, commission, method? }) → { ok, error?, field? }
 *   onCancel:    () → void
 *   checkPayout: async (payout) → { gapLabel, commissionLabel, commission } — rule 26
 *   formatAmountInput: (number) → « 829,42 »
 *   previousDate: `YYYY-MM-DD` — the date of a payment just undone on this row, proposed again
 *
 * Split payments (specs/mixed-method-payments.md rules 21-22, 20, 17):
 *   - a row whose `action.split` is set offers « Plusieurs moyens » after « Annuler »: the lines replace the
 *     caisse-interne switch in place, « Un seul moyen » brings it back with the date kept; the submit then
 *     passes `{ date, tenders, shortfall }`;
 *   mode:        'mark' (default) | 'modify' (a recorded settlement, prefilled, « Enregistrer ») |
 *                'remainder' (the reste of a settlement, one cash line) — both always show the lines
 *   split:       `{ dueCents, methods, whole?, noCaisse? }` for 'modify' / 'remainder' (the row's `action.split` otherwise);
 *                `whole` / `noCaisse` hand TenderLines the rule 44 limits (the acompte, an installment)
 *   initialTenders, initialShortfallKind, initialDate: the prefill of a correction
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { Box, Button, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import DateField from '../DateField';
import TenderLines from '../TenderLines';
import { evaluateArithmetic } from '../../utils/arithmetic';
import { formatCurrency } from '../../utils/formatters';
import { TENDER_TEXTS } from '../../constants/tenderMethods';

export default function PaymentMarkForm({
  row, today, dateLabel, onSubmit, onCancel, checkPayout, formatAmountInput, previousDate = null, methods = null,
  mode = 'mark', split = null, initialTenders = null, initialShortfallKind = null, initialDate = null,
}) {
  const action = row.action || {};
  const payoutMode = Boolean(action.payout);
  const splitInfo = mode === 'mark' ? action.split || null : split;
  const alwaysSplit = mode !== 'mark';
  const [splitOpen, setSplitOpen] = useState(alwaysSplit);
  const [tenderState, setTenderState] = useState(null);
  const showLines = Boolean(splitInfo) && (alwaysSplit || splitOpen);
  // A mark redone after an undo proposes the day it was first recorded (its accounting month).
  const [date, setDate] = useState(initialDate || previousDate || today);
  const [cash, setCash] = useState(false);
  const [method, setMethod] = useState(methods && methods.length ? methods[0].value : null);
  // Prefilled only when the net is known (a commission was entered): otherwise the transfer is typed —
  // a gross prefilled as the transfer would read « cohérent » with a zero commission.
  const [payout, setPayout] = useState(payoutMode && action.payout.expected != null ? formatAmountInput(action.payout.expected) : '');
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
    if (showLines) {
      const res = await onSubmit({ date, tenders: tenderState ? tenderState.tenders : [], shortfall: tenderState ? tenderState.shortfall : null });
      setBusy(false);
      if (res && res.ok === false && res.error) {
        setError({ message: res.error, field: res.field && /date$/i.test(res.field) ? 'date' : null });
      }
      return;
    }
    const payoutValue = payoutMode ? evaluateArithmetic(payout) : null;
    if (payoutMode && (payoutValue == null || payoutValue <= 0)) {
      setError({ message: 'Virement reçu : montant requis.', field: 'payout' });
      setBusy(false);
      return;
    }
    const res = await onSubmit({
      date, cash, payout: payoutMode ? Math.round(payoutValue * 100) / 100 : null, commission,
      ...(methods ? { method } : {}),
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
      {showLines && (
        <TenderLines
          key={splitOpen ? 'open' : 'closed'}
          dueCents={splitInfo.dueCents}
          methods={splitInfo.methods}
          initialTenders={initialTenders}
          initialShortfallKind={initialShortfallKind}
          single={mode === 'remainder'}
          whole={Boolean(splitInfo.whole)}
          noCaisse={Boolean(splitInfo.noCaisse)}
          autoFocus={mode !== 'modify'}
          onChange={setTenderState}
          disabled={busy}
        />
      )}
      {methods && !showLines && (
        <TextField
          select
          label="Mode de paiement"
          size="small"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          helperText=" "
          slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
        >
          {methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </TextField>
      )}
      {previousDate && date && date.slice(0, 7) !== previousDate.slice(0, 7) && (
        <Typography variant="body2" color="warning.text" sx={{ gridColumn: '1 / -1' }}>
          {`Le mois comptable change : ${previousDate.slice(5, 7)}/${previousDate.slice(0, 4)} → ${date.slice(5, 7)}/${date.slice(0, 4)}.`}
        </Typography>
      )}
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
      {action.cash && !showLines && (
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
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !date || (showLines && !(tenderState && tenderState.canSubmit))}
          sx={{ minHeight: 44, borderRadius: 999, textTransform: 'none' }}
        >
          {submitLabel(showLines, mode, tenderState, splitInfo)}
        </Button>
        <Button variant="text" onClick={onCancel} sx={{ minHeight: 44, textTransform: 'none' }}>Annuler</Button>
        {splitInfo && !alwaysSplit && (
          <Button
            variant="text"
            data-split-toggle=""
            onClick={() => { setSplitOpen((open) => !open); setError({ message: '', field: null }); }}
            sx={{ minHeight: 44, textTransform: 'none', color: 'text.secondary', ml: { sm: 'auto' } }}
          >
            {splitOpen ? TENDER_TEXTS.close : TENDER_TEXTS.open}
          </Button>
        )}
      </Box>
    </Box>
  );
}

// « Encaisser 122,00 € », or what is received when the operator chose what becomes of a shortfall.
function submitLabel(showLines, mode, tenderState, splitInfo) {
  if (!showLines) return 'Valider';
  if (mode === 'modify') return TENDER_TEXTS.save;
  const gap = tenderState ? tenderState.gapCents : 0;
  const cents = tenderState && gap > 0 ? tenderState.receivedCents : splitInfo.dueCents;
  return TENDER_TEXTS.collect(formatCurrency(cents / 100));
}
