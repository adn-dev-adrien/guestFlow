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
 *   initialShortfallKind: 'due' | 'waived' | null — prefill of the shortfall choice, for the `dueCents` of the mount
 *   defaultLine:     boolean — `initialTenders` is the screen's proposal of one line of the whole due, not a correction: that line reads
 *                    the due on screen until the operator types its amount (loop t26)
 *   initialDraft:    the `draft` an earlier mount reported (onChange) — the lines exactly as the operator left them, typed or not,
 *                    the shortfall choice and the due it answered (`shortDueCents`, loop t26), the due of the report (`dueCents`); takes precedence over `initialTenders`. A screen that unmounts the block (a failed
 *                    recompute, a step back) passes it back, so nothing typed is lost; an untyped last line still shows what the
 *                    others leave of the new `dueCents`, and a typed line that no longer fits is left as typed, for the meter to say
 *                    (loop t24). The shortfall choice comes back only for the same due; a new due asks it again (loop t25 B25-1),
 *                    as a due that changes while mounted does
 *   single:          boolean — start with one line (collecting a reste)
 *   onChange:        ({ tenders, shortfall, canSubmit, receivedCents, gapCents, dueCents, draft }) → void — `dueCents` is the due
 *                    the report answers, `live()` whether it still describes the lines on screen (sent before paint); a screen commits a
 *                    report only through `tendersForDue(report, due)`, again in its commit handler (loop t25)
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
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, ButtonBase, FormControlLabel, IconButton, InputAdornment, Switch, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { evaluateArithmetic } from '../utils/arithmetic';
import { formatAmountInput, formatCurrency } from '../utils/formatters';
import { TENDER_METHODS, TENDER_TEXTS as T } from '../constants/tenderMethods';
import FocusKeeper from './FocusKeeper';

const MAX_LINES = 4;
const DEFAULT_SHORTFALL_KINDS = ['due', 'waived'];
const toCents = (text) => {
  const value = evaluateArithmetic(text);
  return value == null ? null : Math.round(value * 100);
};
const euros = (cents) => formatCurrency(cents / 100);

// The default line a screen proposes (`defaultLine`: the counter, a booking, a visit — « one line CB of the total ») is `seeded`: until
// the operator types its amount it IS the due, so a new due moves it — and only it (loop t26, rule 59). A correction's lines (a recorded
// settlement prefilled, `defaultLine` false) are what was recorded: typed, whatever their amount.
function seedLines(initialTenders, single, cashInternal, dueCents, defaultLine) {
  if (Array.isArray(initialTenders) && initialTenders.length > 0) {
    const whole = defaultLine && initialTenders.length === 1 && Number(initialTenders[0].amountCents) === Number(dueCents);
    return initialTenders.map((t) => ({
      method: t.method, amount: formatAmountInput(Number(t.amountCents) / 100), internal: Boolean(t.internal), typed: true, ...(whole ? { seeded: true } : {}),
    }));
  }
  if (single) return [{ method: 'cash', amount: '', internal: cashInternal, typed: false }];
  return [
    { method: 'cash', amount: '', internal: cashInternal, typed: false },
    { method: 'card', amount: '', internal: false, typed: false },
  ];
}

/**
 * The report a screen may commit (loop t25, mixed-method-payments rule 59): the last `onChange` report only while it answers the due on
 * screen. Between a new due and the report the lines send for it (one render, an effect later) the old report — its amounts, its shortfall
 * choice — belongs to another due: null, so the commit is pending and never sends it. Every consumer reads its tenders through this.
 */
export const tendersForDue = (report, dueCents) => (report && report.dueCents === dueCents && report.live() ? report : null);

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
  dueCents, methods, initialTenders = null, initialShortfallKind = null, initialDraft = null, single = false, onChange, disabled = false, autoFocus = false,
  whole = false, noCaisse = false, shortfallKinds = DEFAULT_SHORTFALL_KINDS, defaultLine = false,
}) {
  const list = methods && methods.length ? methods : TENDER_METHODS;
  const labelOf = (value) => (list.find((m) => m.value === value) || { label: value }).label;
  // D2 — cash goes to the caisse interne by default; not where the amount is paid whole (rule 44).
  const cashInternal = !whole && !noCaisse;
  const [stored, setLines] = useState(() => (initialDraft && Array.isArray(initialDraft.lines) && initialDraft.lines.length > 0
    ? initialDraft.lines.map((l) => ({ ...l }))
    : seedLines(initialTenders, single, cashInternal, dueCents, defaultLine)));
  // A seeded line reads the due on screen; any line the operator typed keeps what was typed (mixed-method-payments rule 59).
  const lines = useMemo(
    () => stored.map((l) => (l.seeded ? { ...l, amount: formatAmountInput(dueCents / 100) } : l)),
    [stored, dueCents],
  );
  // The shortfall choice answers for ONE amount due (loop t25 B25-1): a « Geste commercial » chosen for 50 € of 500 € is not one for
  // 134 € of 584 €. It holds while the due it was chosen for is the due on screen — through a remount too (the draft carries that due) —
  // and is asked again once the due moves, the commit waiting for the answer. The lines themselves stay as typed.
  const [shortChoice, setShortChoice] = useState(() => (initialDraft
    ? { kind: initialDraft.shortKind ?? null, dueCents: initialDraft.shortDueCents ?? initialDraft.dueCents }
    : { kind: initialShortfallKind, dueCents }));
  const shortKind = shortChoice.dueCents === dueCents ? shortChoice.kind : null;
  const setShortKind = (kind) => setShortChoice({ kind, dueCents });
  const firstAmount = useRef(null);
  const figures = useMemo(() => tenderFigures(lines, dueCents), [lines, dueCents]);
  const { autoIndex, autoCents, gapCents, receivedCents, unreadable, amounts } = figures;
  // Loop t25 — the lines on screen, as of the latest render: a report answers them only while its signature is this one (`live()`), so a
  // click that lands before the report of the lines just typed sends nothing.
  const signature = JSON.stringify([stored, shortKind, dueCents]);
  const onScreen = useRef(null);
  onScreen.current = signature;
  // Lines no longer drawn describe nothing on screen: once this block is unmounted its reports are dead (loop t26 verifier — reopened, a
  // block's first commit showed « Encaisser 5,00 € » from the report of the block just closed, before the new lines reported).
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (autoFocus && firstAmount.current) firstAmount.current.focus();
  }, [autoFocus]);

  // Loop t25 — before paint (`useLayoutEffect`): the screen's button never shows a frame judged on the previous lines.
  useLayoutEffect(() => {
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
      dueCents,
      // The choice travels with the due it answered (loop t26): a block drawn again on another due keeps it for when that due is back.
      draft: {
        lines: stored, shortKind: shortChoice.kind, shortDueCents: shortChoice.dueCents, dueCents,
      },
      live: () => alive.current && onScreen.current === signature,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, shortKind, dueCents, shortChoice]);

  // Every gesture works on the lines as drawn: a seeded line the operator touches becomes an ordinary typed one.
  const settle = (prev) => prev.map((l) => (l.seeded ? { ...l, amount: formatAmountInput(dueCents / 100), seeded: undefined } : l));
  const update = (index, patch) => setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  // Any line the operator types in is typed (loop t26): it keeps its amount when a line after it is removed, instead of turning into
  // the remainder. Emptying the last line gives the remainder back to it.
  const typeAmount = (index, value) => setLines((prev) => settle(prev).map((l, i) => {
    if (i !== index) return l;
    return { ...l, amount: value, typed: value.trim() !== '' };
  }));
  const remove = (index) => setLines((prev) => {
    const next = settle(prev).filter((_, i) => i !== index);
    const last = next[next.length - 1];
    if (last && String(last.amount || '').trim() === '') next[next.length - 1] = { ...last, typed: false };
    return next;
  });
  const add = () => setLines((raw) => {
    const prev = settle(raw);
    const used = new Set(prev.map((l) => l.method));
    const next = list.find((m) => !used.has(m.value)) || list[list.length - 1];
    const frozen = prev.map((l, i) => (i === autoIndex ? { ...l, amount: autoCents ? formatAmountInput(autoCents / 100) : '', typed: true } : l));
    return [...frozen, { method: next.value, amount: '', internal: next.value === 'cash' && cashInternal, typed: false }];
  });

  const meterTone = gapCents === 0 ? 'success.text' : gapCents < 0 ? 'error.main' : 'warning.text';
  const meterText = gapCents === 0 ? T.covered : gapCents < 0 ? T.over(euros(-gapCents)) : T.short(euros(gapCents));

  return (
    // Loop t26 (rule 58, I4) — a line removed or « Ajouter un moyen » gone at four lines leaves the focus in the block, on every host.
    <FocusKeeper sx={{ display: 'grid', gap: 1.25, containerType: 'inline-size', gridColumn: '1 / -1' }}>
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
    </FocusKeeper>
  );
}
