/**
 * TenderLines — one amount paid with several methods (specs/mixed-method-payments.md §3.3, §6): one line per
 * method (method · amount · « Caisse interne » on cash), the last untyped line showing what remains, a meter,
 * and — when the lines fall short — the choice of what becomes of the amount not received.
 *
 * Generic: it knows no reservation, only an amount due and a list of methods. Used by the fiche's ledger rows,
 * the « Encaisser en une fois » block, the installments, the mid-stay notes and both SAS payment steps, at
 * entry, on a correction and for a reste.
 *
 * The running remainder is a UX hint (rule 7): the server validates every line and the shortfall (rules 6, 15).
 *
 * Props:
 *   dueCents:        number — the amount due, in cents                                            (required)
 *   methods:         [{ value, label }] — the server's list (falls back to constants/tenderMethods)
 *   initialTenders:  [{ method, amountCents, internal }] | null — prefill (a correction); null = two lines
 *                    Espèces (caisse interne) + CB, or one cash line with `single`
 *   initialShortfallKind: 'due' | 'waived' | null — prefill of the shortfall choice
 *   single:          boolean — start with one line (collecting a reste)
 *   onChange:        ({ tenders, shortfall, canSubmit, receivedCents, gapCents }) → void
 *   disabled:        boolean
 *   autoFocus:       boolean — focus the first amount when mounted
 *   whole:           boolean — the amount is paid whole, no shortfall choice (rule 44: the acompte, an installment);
 *                    a cash line then starts on the books
 *   noCaisse:        boolean — no « Caisse interne » switch (rule 44: an installment)
 *   shortfallKinds:  ['due', 'waived'] — which choices the shortfall block offers; the outside visit passes ['due'] (« Geste commercial » is an offered line there,
 *                    specs/outside-booking-sas.md rule 17). The server refuses the others whatever the screen shows.
 *
 * An untyped last line left at 0 (the others cover the amount) is not a line: it is not sent and blocks nothing.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, ButtonBase, FormControlLabel, IconButton, InputAdornment, Switch, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { evaluateArithmetic } from '../utils/arithmetic';
import { formatAmountInput, formatCurrency } from '../utils/formatters';
import { TENDER_METHODS, TENDER_TEXTS as T } from '../constants/tenderMethods';

const MAX_LINES = 4;
const DEFAULT_SHORTFALL_KINDS = ['due', 'waived'];
const toCents = (text) => {
  const value = evaluateArithmetic(text);
  return value == null ? null : Math.round(value * 100);
};
const euros = (cents) => formatCurrency(cents / 100);

function seedLines(initialTenders, single, cashInternal) {
  if (Array.isArray(initialTenders) && initialTenders.length > 0) {
    return initialTenders.map((t) => ({
      method: t.method, amount: formatAmountInput(Number(t.amountCents) / 100), internal: Boolean(t.internal), typed: true,
    }));
  }
  if (single) return [{ method: 'cash', amount: '', internal: cashInternal, typed: false }];
  return [
    { method: 'cash', amount: '', internal: cashInternal, typed: false },
    { method: 'card', amount: '', internal: false, typed: false },
  ];
}

// The last line, while untyped, shows what the others leave (rule 7).
export function tenderFigures(lines, dueCents) {
  const autoIndex = lines.length > 0 && !lines[lines.length - 1].typed ? lines.length - 1 : -1;
  let typedCents = 0;
  let unreadable = false;
  lines.forEach((l, i) => {
    if (i === autoIndex) return;
    const c = toCents(l.amount);
    if (String(l.amount || '').trim() !== '' && c == null) unreadable = true;
    else if (c) typedCents += c;
  });
  const autoCents = autoIndex >= 0 ? Math.max(dueCents - typedCents, 0) : null;
  const receivedCents = typedCents + (autoCents || 0);
  const amounts = lines.map((l, i) => (i === autoIndex ? autoCents : toCents(l.amount)));
  return { autoIndex, autoCents, receivedCents, gapCents: dueCents - receivedCents, unreadable, amounts };
}

export default function TenderLines({
  dueCents, methods, initialTenders = null, initialShortfallKind = null, single = false, onChange, disabled = false, autoFocus = false,
  whole = false, noCaisse = false, shortfallKinds = DEFAULT_SHORTFALL_KINDS,
}) {
  const list = methods && methods.length ? methods : TENDER_METHODS;
  const labelOf = (value) => (list.find((m) => m.value === value) || { label: value }).label;
  // D2 — cash goes to the caisse interne by default; not where the amount is paid whole (rule 44).
  const cashInternal = !whole && !noCaisse;
  const [lines, setLines] = useState(() => seedLines(initialTenders, single, cashInternal));
  const [shortKind, setShortKind] = useState(initialShortfallKind);
  const firstAmount = useRef(null);
  const figures = useMemo(() => tenderFigures(lines, dueCents), [lines, dueCents]);
  const { autoIndex, autoCents, gapCents, receivedCents, unreadable, amounts } = figures;

  useEffect(() => {
    if (autoFocus && firstAmount.current) firstAmount.current.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (typeof onChange !== 'function') return;
    // An untyped last line the others already cover (0) is no line at all (audit R34-C-L2).
    const sent = lines.map((l, i) => i).filter((i) => !(i === autoIndex && autoCents === 0 && lines.length > 1));
    const everyAmount = sent.every((i) => amounts[i] != null && amounts[i] > 0);
    const short = gapCents > 0;
    const canSubmit = !unreadable && everyAmount && receivedCents > 0 && gapCents >= 0 && (!short || (!whole && Boolean(shortKind)));
    onChange({
      tenders: sent.map((i) => ({ method: lines[i].method, amountCents: amounts[i] || 0, internal: lines[i].method === 'cash' && lines[i].internal && !noCaisse })),
      shortfall: short && shortKind && !whole ? { kind: shortKind } : null,
      canSubmit,
      receivedCents,
      gapCents,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, shortKind, dueCents]);

  const update = (index, patch) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const typeAmount = (index, value) => setLines((prev) => prev.map((l, i) => {
    if (i !== index) return l;
    // Typing in the last line freezes it; emptying it gives the remainder back to it.
    return { ...l, amount: value, typed: i === prev.length - 1 ? value.trim() !== '' : l.typed };
  }));
  const remove = (index) => setLines((prev) => {
    const next = prev.filter((_, i) => i !== index);
    const last = next[next.length - 1];
    if (last && String(last.amount || '').trim() === '') next[next.length - 1] = { ...last, typed: false };
    return next;
  });
  const add = () => setLines((prev) => {
    const used = new Set(prev.map((l) => l.method));
    const next = list.find((m) => !used.has(m.value)) || list[list.length - 1];
    const frozen = prev.map((l, i) => (i === autoIndex ? { ...l, amount: autoCents ? formatAmountInput(autoCents / 100) : '', typed: true } : l));
    return [...frozen, { method: next.value, amount: '', internal: next.value === 'cash' && cashInternal, typed: false }];
  });

  const meterTone = gapCents === 0 ? 'success.text' : gapCents < 0 ? 'error.main' : 'warning.text';
  const meterText = gapCents === 0 ? T.covered : gapCents < 0 ? T.over(euros(-gapCents)) : T.short(euros(gapCents));

  return (
    <Box sx={{ display: 'grid', gap: 1.25, containerType: 'inline-size', gridColumn: '1 / -1' }}>
      {lines.map((line, index) => {
        const isAuto = index === autoIndex;
        const shown = isAuto ? (autoCents ? formatAmountInput(autoCents / 100) : '') : line.amount;
        return (
          <Box
            key={index}
            data-tender-line={index}
            sx={{
              display: 'grid', gap: 1, p: 1.25, borderRadius: 1.5, bgcolor: 'background.paper', border: 1, borderColor: 'divider',
              gridTemplateColumns: '1fr',
              '@container (min-width: 560px)': { gridTemplateColumns: '170px minmax(0, 1fr)', alignItems: 'center' },
            }}
          >
            <TextField
              select
              size="small"
              value={line.method}
              disabled={disabled}
              onChange={(e) => update(index, { method: e.target.value, internal: e.target.value === 'cash' && cashInternal })}
              slotProps={{ select: { native: true }, htmlInput: { 'aria-label': T.methodAria(index + 1) } }}
            >
              {list.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </TextField>
            <Box sx={{
              display: 'grid', gap: 0.5, alignItems: 'center', gridTemplateColumns: 'minmax(0, 1fr) auto',
              '@container (min-width: 560px)': { gridTemplateColumns: 'minmax(0, 1fr) auto auto' },
            }}
            >
              <TextField
                size="small"
                value={shown}
                disabled={disabled}
                inputRef={index === 0 ? firstAmount : undefined}
                placeholder="0,00"
                autoComplete="off"
                onChange={(e) => typeAmount(index, e.target.value)}
                onFocus={(e) => { if (isAuto) e.target.select(); }}
                slotProps={{
                  htmlInput: { inputMode: 'decimal', 'aria-label': T.amountAria(labelOf(line.method)), 'data-tender-amount': index },
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <Typography variant="caption" color="text.secondary">{isAuto ? T.remainderSuffix : '€'}</Typography>
                      </InputAdornment>
                    ),
                  },
                }}
                sx={{
                  '& input': { fontSize: 16, fontVariantNumeric: 'tabular-nums', color: isAuto ? 'text.secondary' : 'text.primary' },
                  '& .MuiOutlinedInput-root': { bgcolor: isAuto ? 'background.default' : 'background.paper' },
                }}
              />
              {lines.length > 1 && (
                <IconButton
                  aria-label={T.remove}
                  disabled={disabled}
                  onClick={() => remove(index)}
                  sx={{ width: 44, height: 44, gridColumn: { xs: 2 }, '@container (min-width: 560px)': { gridColumn: 3 } }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              )}
              {line.method === 'cash' && !noCaisse && (
                <FormControlLabel
                  control={<Switch checked={line.internal} disabled={disabled} onChange={(e) => update(index, { internal: e.target.checked })} />}
                  label={T.internal}
                  sx={{
                    m: 0, minHeight: 44, gridRow: 2, gridColumn: '1 / -1',
                    '@container (min-width: 560px)': { gridRow: 'auto', gridColumn: 2 },
                  }}
                />
              )}
            </Box>
          </Box>
        );
      })}
      {lines.length < MAX_LINES && (
        <Button
          variant="text"
          size="small"
          startIcon={<AddIcon />}
          onClick={add}
          disabled={disabled}
          sx={{ justifySelf: 'start', textTransform: 'none', color: 'text.secondary', minHeight: 44 }}
        >
          {T.add}
        </Button>
      )}
      <Box aria-live="polite" sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, px: 0.5 }}>
        <Typography variant="body2">{`${T.due} ${euros(dueCents)}`}</Typography>
        <Typography variant="body2" data-tender-meter="" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: meterTone }}>
          {meterText}
        </Typography>
      </Box>
      {gapCents > 0 && !unreadable && whole && (
        <Typography variant="body2" data-tender-whole="" sx={{ px: 0.5, color: 'warning.text' }}>{T.whole}</Typography>
      )}
      {gapCents > 0 && !unreadable && !whole && (
        <Box
          role="group"
          aria-label={T.shortTitle(euros(gapCents))}
          sx={{
            display: 'grid', gap: 1, p: 1.5, borderRadius: 1.5, bgcolor: 'warning.soft',
            animation: 'tenderOpen 200ms ease-out',
            '@keyframes tenderOpen': { from: { opacity: 0, transform: 'translateY(-4px)' }, to: { opacity: 1, transform: 'none' } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'warning.text' }}>{T.shortTitle(euros(gapCents))}</Typography>
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr', '@container (min-width: 520px)': { gridTemplateColumns: shortfallKinds.length > 1 ? '1fr 1fr' : '1fr' } }}>
            {[
              { kind: 'due', title: T.dueTitle, help: T.dueHelp(euros(gapCents)) },
              { kind: 'waived', title: T.waivedTitle, help: T.waivedHelp(euros(gapCents)) },
            ].filter((choice) => shortfallKinds.includes(choice.kind)).map((choice) => {
              const on = shortKind === choice.kind;
              return (
                <ButtonBase
                  key={choice.kind}
                  data-shortfall={choice.kind}
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => setShortKind(choice.kind)}
                  sx={{
                    display: 'grid', gap: 0.25, textAlign: 'left', justifyItems: 'start', p: 1.25, minHeight: 44, borderRadius: 1.5,
                    bgcolor: 'background.paper', border: 1, borderColor: on ? 'primary.main' : 'divider',
                    boxShadow: on ? (t) => `0 0 0 2px ${t.palette.primary.light}` : 'none',
                    transition: 'border-color 160ms, box-shadow 160ms',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{choice.title}</Typography>
                  <Typography variant="caption" color="text.secondary">{choice.help}</Typography>
                </ButtonBase>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}
