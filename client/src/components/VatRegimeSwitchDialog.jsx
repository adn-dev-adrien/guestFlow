/**
 * VatRegimeSwitchDialog — « Passer sans TVA » / « Passer à la TVA » (specs/vat-optional-mode.md §6.2).
 *
 * The inputs of a switch (the rate or the legal mention, the scope and its date), the server's preview
 * of what it changes — re-asked 300 ms after each edit — the acknowledgement a correction needs, and the
 * refusals the server words (a date, a rate, a set that moved since the preview). It validates nothing
 * itself: the field errors it shows are the 422 of the preview. Specific to the VAT regime: it is built
 * on `FormDialog` and the page's own constants.
 *
 * Props:
 *   open, onClose
 *   inForce:    the period in force (its regime decides the target)
 *   mentions:   [{ key, label }] — the two legal mentions
 *   preview:    (input) => Promise<{ fingerprint, lines, exportMonths, … }> (rejects with `.errors` on 422)
 *   onSubmit:   (input) => Promise — the switch; rejects with `.status === 409` when the preview is stale
 *   onDone:     (result) => void — after a successful switch
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Box, Checkbox, FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material';
import FormDialog from './FormDialog';
import StatusBadge from './StatusBadge';
import ErrorAlert from './ErrorAlert';
import { localIsoToday } from '../utils/isoDay';
import {
  VAT_BASIS, VAT_SCOPES, VAT_TEXTS, regimeLabel, switchSubmit, switchTitle,
} from '../constants/vatRegime';

const PREVIEW_DELAY_MS = 300;

function initialDraft(inForce) {
  const today = localIsoToday();
  return {
    regime: inForce && inForce.regime === 'subject' ? 'not_subject' : 'subject',
    rate: '10',
    legalMention: 'art_293_b',
    basis: VAT_BASIS.BOOKING,
    dates: { [VAT_BASIS.BOOKING]: today, [VAT_BASIS.ARRIVAL]: today },
  };
}

const inputOf = (draft) => ({
  regime: draft.regime,
  ...(draft.regime === 'subject' ? { rate: draft.rate } : { legalMention: draft.legalMention }),
  basis: draft.basis,
  ...(draft.basis === VAT_BASIS.ALL ? {} : { effectiveFrom: draft.dates[draft.basis] }),
});

export default function VatRegimeSwitchDialog({ open, onClose, inForce, mentions = [], preview, onSubmit, onDone }) {
  const [draft, setDraft] = useState(() => initialDraft(inForce));
  const [result, setResult] = useState({ status: 'idle', data: null, errors: {} });
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [failure, setFailure] = useState(null);
  const ticket = useRef(0);

  useEffect(() => {
    if (open) {
      setDraft(initialDraft(inForce));
      setAcknowledged(false);
      setResult({ status: 'idle', data: null, errors: {} });
      setStale(false);
      setFailure(null);
    }
  }, [open, inForce]);

  useEffect(() => {
    if (!open) return undefined;
    const mine = ticket.current + 1;
    ticket.current = mine;
    setResult((prev) => ({ ...prev, status: 'loading' }));
    const timer = setTimeout(async () => {
      try {
        const data = await preview(inputOf(draft));
        if (ticket.current === mine) setResult({ status: 'ready', data, errors: {} });
      } catch (err) {
        if (ticket.current !== mine) return;
        if (err && err.errors) setResult({ status: 'invalid', data: null, errors: err.errors });
        else setResult({ status: 'failed', data: null, errors: {} });
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [open, draft, preview]);

  const set = (patch) => { setDraft((prev) => ({ ...prev, ...patch })); setStale(false); setFailure(null); };
  const chooseScope = (basis) => { setAcknowledged(false); set({ basis }); };
  const toNotSubject = draft.regime === 'not_subject';
  const correction = draft.basis === VAT_BASIS.ALL;
  const { errors } = result;
  const ready = result.status === 'ready';
  const monthsAffected = ready && result.data.accountingExportActive && result.data.exportMonths.length > 0;
  const submitDisabled = !ready || (correction && !acknowledged);
  const mention = mentions.find((m) => m.key === draft.legalMention);

  const submit = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const done = await onSubmit({ ...inputOf(draft), fingerprint: result.data.fingerprint, acknowledged: correction ? acknowledged : undefined });
      onDone(done);
    } catch (err) {
      if (err && err.status === 409) { setStale(true); setDraft((prev) => ({ ...prev })); }
      else if (err && err.errors) setResult({ status: 'invalid', data: null, errors: err.errors });
      else setFailure((err && err.message) || 'Le changement a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const target = toNotSubject ? 'Sans TVA' : `Assujetti · ${String(draft.rate || '…').replace('.', ',')} %`;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={switchTitle(toNotSubject)}
      submitLabel={switchSubmit(toNotSubject, correction)}
      submitColor={correction ? 'warning' : 'primary'}
      onSubmit={submit}
      submitDisabled={submitDisabled}
      submitBusy={busy}
    >
      <Stack spacing={2.5} sx={{ pt: 0.5 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }} aria-label="Régime actuel et régime visé">
          {inForce && <StatusBadge status={inForce.regime === 'subject' ? 'success' : 'neutral'} label={regimeLabel(inForce)} />}
          <Typography component="span" aria-hidden color="text.secondary">→</Typography>
          <StatusBadge status={toNotSubject ? 'neutral' : 'success'} label={target} />
        </Stack>

        {toNotSubject ? (
          <TextField
            select
            label="Mention légale"
            value={draft.legalMention}
            onChange={(e) => set({ legalMention: e.target.value })}
            error={Boolean(errors.legalMention)}
            helperText={errors.legalMention || (mention ? `« ${mention.label} »` : ' ')}
            fullWidth
          >
            {mentions.map((m) => <MenuItem key={m.key} value={m.key}>{m.label}</MenuItem>)}
          </TextField>
        ) : (
          <TextField
            label="Taux de TVA (%)"
            value={draft.rate}
            onChange={(e) => set({ rate: e.target.value })}
            error={Boolean(errors.rate)}
            helperText={errors.rate || VAT_TEXTS.rateHelp}
            sx={{ maxWidth: { sm: 240 } }}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
        )}

        <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
          <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>{VAT_TEXTS.appliesTo}</Typography>
          <RadioGroup value={draft.basis} onChange={(e) => chooseScope(e.target.value)}>
            <Stack spacing={1}>
              {VAT_SCOPES.map((scope) => {
                const selected = draft.basis === scope.value;
                const dateError = selected && errors.effectiveFrom;
                const scheduled = selected && scope.dated && draft.dates[scope.value] > localIsoToday();
                return (
                  <Box
                    key={scope.value}
                    component="label"
                    sx={(t) => ({
                      display: 'block', border: 1, borderRadius: 1, p: 1.5, cursor: 'pointer',
                      borderColor: selected ? 'primary.main' : 'divider',
                      bgcolor: selected ? t.palette.action.hover : 'transparent',
                    })}
                  >
                    <FormControlLabel
                      value={scope.value}
                      control={<Radio />}
                      label={<Typography variant="body2" sx={{ fontWeight: 600 }}>{scope.title}</Typography>}
                      sx={{ m: 0, alignItems: 'center' }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4.5, mb: scope.dated ? 1 : 0 }}>
                      {scope.hint}
                    </Typography>
                    {scope.dated && (
                      <TextField
                        type="date"
                        size="small"
                        value={draft.dates[scope.value]}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => set({ basis: scope.value, dates: { ...draft.dates, [scope.value]: e.target.value } })}
                        error={Boolean(dateError)}
                        helperText={dateError || (scheduled ? VAT_TEXTS.scheduledHelp : ' ')}
                        sx={{ ml: { sm: 4.5 }, width: { xs: '100%', sm: 220 } }}
                        slotProps={{ htmlInput: { 'aria-label': `${scope.title} : date` } }}
                      />
                    )}
                  </Box>
                );
              })}
            </Stack>
          </RadioGroup>
        </Box>

        <Box
          aria-live="polite"
          sx={(t) => ({ bgcolor: t.palette.action.hover, borderRadius: 1, p: 1.5, opacity: result.status === 'loading' ? 0.6 : 1 })}
        >
          <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{VAT_TEXTS.whatChanges}</Typography>
          {ready ? (
            <Box component="ul" sx={{ m: 0, pl: 2.25 }}>
              {result.data.lines.map((line) => <Typography key={line} component="li" variant="body2">{line}</Typography>)}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {result.status === 'failed' ? 'Aperçu indisponible.' : VAT_TEXTS.previewWaiting}
            </Typography>
          )}
        </Box>

        {correction && (
          <FormControlLabel
            control={<Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />}
            label={monthsAffected ? VAT_TEXTS.ackSent : VAT_TEXTS.ackDocuments}
            sx={{ alignItems: 'flex-start', '& .MuiCheckbox-root': { pt: 0.5 } }}
          />
        )}
        {errors.acknowledged && <ErrorAlert message={errors.acknowledged} />}
        {stale && <ErrorAlert message={VAT_TEXTS.stale} />}
        {failure && <ErrorAlert message={failure} />}
      </Stack>
    </FormDialog>
  );
}
