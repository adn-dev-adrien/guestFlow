/**
 * InstallmentPlanCard — the « Échéancier » of a direct reservation (specs/direct-installments.md §6).
 *
 * Renders the server's `installmentPlan` payload and posts the operator's inputs (count, dates, amounts); it
 * computes no amount, date or status (CLAUDE.md §6.0). Every change saves at once through the API, like the
 * ledger's marks, and the answer replaces the plan.
 *
 * The count stepper follows the rapid clicks: the count shown moves at once, only the final count is sent
 * once clicks stop (300 ms), and a reply older than the last request never moves it back. Its two buttons are
 * never unmounted, so a click always lands on the button actually pressed.
 *
 * A date is sent when its field is left (or Enter), never per keystroke; an amount likewise. A value the server
 * refused is not sent again until it changes.
 *
 * While the fiche has unsaved changes the card is read-only (rule 44): the plan follows what is SAVED.
 *
 * Specific to the reservation fiche (a list of dated amounts nothing else edits).
 *
 * Props:
 *   reservationId:  number
 *   plan:           the `installmentPlan` payload ({ eligible, canCreate, reason, countLocked, frozen, total,
 *                   paid, remaining, gap, minCount, maxCount, count, canRequest, arrivalDate, installments[] })
 *   today:          `YYYY-MM-DD` — the day the mark form proposes
 *   disabled:       the fiche is dirty: nothing here may be changed until it is saved
 *   onPlanChange:   (plan) → void — the server's answer, to keep
 *   onMoneyChanged: () → void — the plan moved the stay's money: re-read the ledger
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import api from '../../api';
import DateField from '../DateField';
import StatusBadge from '../StatusBadge';
import PaymentMarkForm from './PaymentMarkForm';
import { useToast } from '../DialogProvider';
import { formatAmountInput, formatCurrency, displayDate } from '../../utils/formatters';
import * as t from '../../constants/installmentStrings';
import { isLinkAlreadyPaid } from '../../constants/paymentLinks';

const COUNT_DEBOUNCE_MS = 300;
const DEFAULT_COUNT = 3;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const BADGE = { paid: 'success', late: 'error', requested: 'info', toRequest: 'warning', upcoming: 'neutral' };

// The fiche column can be narrow even on a wide screen: the layout follows the width of the card, not the
// window's. Narrow = a two-line card (number + status, then date + amount, then the actions); wide = one line.
const WIDE = '@container (min-width: 720px)';
const HEADER_WIDE = '@container (min-width: 560px)';

// The grid only names the areas the row really fills, so an empty zone never adds a row gap.
function rowLayout({ hasActions, hasError }) {
  const narrow = ['"n badge"', '"date amt"', hasActions && '"acts acts"', hasError && '"err err"'].filter(Boolean).join(' ');
  const wideMain = hasActions ? '"n date amt badge acts"' : '"n date amt badge"';
  const wide = hasError ? `${wideMain} ". err err err${hasActions ? ' err' : ''}"` : wideMain;
  return {
    gridTemplateColumns: '1fr auto',
    gridTemplateAreas: narrow,
    [WIDE]: {
      gridTemplateColumns: hasActions ? '34px 170px 1fr auto auto' : '34px 170px 1fr auto',
      gridTemplateAreas: wide,
    },
  };
}

function InstallmentRow({ installment, arrivalDate, dateError, amountError, busy, locked, canRequest, onDate, onAmount, onSend, onCopy, onPay }) {
  const paid = installment.status === 'paid';
  const [dateDraft, setDateDraft] = useState(installment.dueDate);
  const [amountDraft, setAmountDraft] = useState(String(installment.amount));
  // What the server holds wins again once its refusal is gone, or the plan moved under the field.
  useEffect(() => { if (!dateError) setDateDraft(installment.dueDate); }, [installment.dueDate, dateError]);
  useEffect(() => { if (!amountError) setAmountDraft(String(installment.amount)); }, [installment.amount, amountError]);

  const commitDate = (value) => {
    if (!ISO_DAY.test(value) || value === installment.dueDate) return;
    if (dateError && dateError.value === value) return;
    onDate(installment, value);
  };
  const commitAmount = () => {
    const typed = amountDraft.trim().replace(',', '.');
    if (typed === '') { setAmountDraft(String(installment.amount)); return; }
    if (typed === String(installment.amount)) return;
    if (amountError && amountError.value === typed) return;
    onAmount(installment, typed);
  };

  const showAmountInput = installment.amountEditable;
  const hasActions = !paid;
  const error = dateError || amountError;
  return (
    <Box
      data-testid={`installment-${installment.number}`}
      sx={{
        display: 'grid',
        alignItems: 'center',
        columnGap: 1.5,
        rowGap: 1,
        p: 1.25,
        border: '1px solid',
        borderColor: paid ? 'success.light' : 'divider',
        borderRadius: 2,
        ...(paid ? { bgcolor: 'success.soft' } : {}),
        [WIDE]: { p: 1.5 },
        ...rowLayout({ hasActions, hasError: Boolean(error) }),
        transition: 'background-color 250ms ease',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      <Typography sx={{ gridArea: 'n', fontWeight: 600, color: 'text.secondary' }}>{installment.number}</Typography>

      <Box sx={{ gridArea: 'date' }}>
        {paid ? (
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {displayDate(installment.paidDate || installment.dueDate)}
          </Typography>
        ) : (
          <DateField
            size="small"
            fullWidth
            value={dateDraft}
            disabled={busy || locked}
            error={Boolean(dateError)}
            onChange={(e) => setDateDraft(e.target.value)}
            onBlur={(e) => commitDate(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitDate(e.target.value); }}
            slotProps={{ htmlInput: { 'aria-label': t.DATE_LABEL(installment.number), max: arrivalDate || undefined, 'aria-invalid': dateError ? 'true' : undefined } }}
            sx={{ '& input': { fontSize: 16 } }}
          />
        )}
      </Box>

      <Box sx={{ gridArea: 'amt', justifySelf: 'end', textAlign: 'right' }}>
        {showAmountInput ? (
          <TextField
            size="small"
            value={amountDraft}
            disabled={busy || locked}
            error={Boolean(amountError)}
            onChange={(e) => setAmountDraft(e.target.value)}
            onBlur={commitAmount}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitAmount(); } }}
            slotProps={{
              input: { endAdornment: <InputAdornment position="end">€</InputAdornment> },
              htmlInput: { inputMode: 'numeric', 'aria-label': t.AMOUNT_LABEL(installment.number), 'aria-invalid': amountError ? 'true' : undefined },
            }}
            sx={{ width: 120, '& input': { textAlign: 'right', fontWeight: 600, fontSize: 16, fontVariantNumeric: 'tabular-nums' } }}
          />
        ) : (
          <Typography sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(installment.amount)}</Typography>
        )}
        {installment.amountEdited && (
          <Typography variant="caption" color="info.text" sx={{ display: 'block' }}>{t.PINNED_MARK}</Typography>
        )}
        {installment.added > 0 && (
          <Typography variant="caption" color="warning.text" sx={{ display: 'block' }}>{t.ADDED_MARK(formatCurrency(installment.added))}</Typography>
        )}
      </Box>

      <Box sx={{ gridArea: 'badge', justifySelf: 'end' }}>
        <StatusBadge status={BADGE[installment.status] || 'neutral'} label={installment.statusLabel} />
      </Box>

      {hasActions && (
        <Stack direction="row" spacing={0.75} sx={{ gridArea: 'acts', '& > button': { flex: 1 }, [WIDE]: { justifyContent: 'flex-end', '& > button': { flex: 'none' } } }}>
          {installment.linkUrl && installment.requestedAt && (
            <Button variant="outlined" onClick={() => onCopy(installment)} sx={{ minHeight: 44, textTransform: 'none' }}>{t.ACTION_COPY}</Button>
          )}
          {!installment.requestedAt && canRequest && (
            <Button variant="outlined" disabled={busy || locked} onClick={() => onSend(installment)} sx={{ minHeight: 44, textTransform: 'none' }}>{t.ACTION_SEND}</Button>
          )}
          <Button variant="contained" disabled={busy || locked} onClick={() => onPay(installment)} sx={{ minHeight: 44, textTransform: 'none' }}>{t.ACTION_PAY}</Button>
        </Stack>
      )}

      {error && (
        <Typography role="alert" variant="body2" color="error" sx={{ gridArea: 'err' }}>
          {error.message}
        </Typography>
      )}
    </Box>
  );
}

export default function InstallmentPlanCard({ reservationId, plan, today, disabled = false, onPlanChange, onMoneyChanged }) {
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [markingId, setMarkingId] = useState(null);
  const [confirmCount, setConfirmCount] = useState(null);
  // A count is on its way (clicks being gathered, or the request in flight): nothing else may start.
  const [settling, setSettling] = useState(false);

  // The stepper: what the operator asked for (`wanted`), what is shown, the pending send, the last request.
  const [shown, setShown] = useState(plan.count || DEFAULT_COUNT);
  const wanted = useRef(plan.count || DEFAULT_COUNT);
  const lastSent = useRef(plan.count);
  const timer = useRef(null);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const planRef = useRef(plan);
  planRef.current = plan;

  useEffect(() => {
    if (timer.current === null && !inFlight.current && plan.count) {
      wanted.current = plan.count;
      lastSent.current = plan.count;
      setShown(plan.count);
    }
  }, [plan.count]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const fail = useCallback((error) => showError(error && error.message ? error.message : t.GENERIC_ERROR), [showError]);

  const accept = useCallback((answer) => {
    onPlanChange(answer.installmentPlan);
    if (onMoneyChanged) onMoneyChanged();
  }, [onPlanChange, onMoneyChanged]);

  // Whatever else is about to change the plan first drops the count that was being gathered or sent.
  const abandonCount = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    sequence.current += 1;
    inFlight.current = false;
    setSettling(false);
  }, []);

  const sendCount = useCallback(async (count) => {
    timer.current = null;
    // Compared with the last count SENT, not the plan's: a reply still on its way must not hide a change of mind.
    if (count === lastSent.current) { setSettling(false); return; }
    const mine = ++sequence.current;
    lastSent.current = count;
    inFlight.current = true;
    try {
      const answer = await api.putInstallments(reservationId, { count });
      if (mine !== sequence.current || timer.current !== null) return;
      setErrors({});
      accept(answer);
    } catch (error) {
      if (mine !== sequence.current || timer.current !== null) return;
      wanted.current = planRef.current.count;
      lastSent.current = planRef.current.count;
      setShown(planRef.current.count);
      fail(error);
    } finally {
      if (mine === sequence.current) { inFlight.current = false; if (timer.current === null) setSettling(false); }
    }
  }, [reservationId, accept, fail]);

  const aim = useCallback((count, delay = COUNT_DEBOUNCE_MS) => {
    wanted.current = count;
    setShown(count);
    setSettling(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => sendCount(count), delay);
  }, [sendCount]);

  const hasEdits = plan.installments.some((i) => i.dateEdited || i.amountEdited);
  const step = (delta) => {
    const next = Math.min(plan.maxCount, Math.max(plan.minCount, wanted.current + delta));
    if (next === wanted.current) return;
    if (hasEdits && timer.current === null && !inFlight.current) { setConfirmCount(next); return; }
    aim(next);
  };

  const create = async () => {
    abandonCount();
    setBusy(true);
    try {
      accept(await api.putInstallments(reservationId, { count: DEFAULT_COUNT }));
    } catch (error) { fail(error); } finally { setBusy(false); }
  };

  const remove = async () => {
    abandonCount();
    setBusy(true);
    try {
      accept(await api.deleteInstallments(reservationId));
      setErrors({});
    } catch (error) { fail(error); } finally { setBusy(false); }
  };

  const setError = (id, kind, error) => setErrors((prev) => ({ ...prev, [`${id}:${kind}`]: error }));
  const clearError = (id, kind) => setErrors((prev) => { const { [`${id}:${kind}`]: _gone, ...rest } = prev; return rest; });

  const onDate = async (installment, dueDate) => {
    setBusy(true);
    try {
      accept(await api.putInstallments(reservationId, { dates: [{ id: installment.id, dueDate }] }));
      clearError(installment.id, 'date');
    } catch (error) {
      setError(installment.id, 'date', { message: error.message, value: dueDate });
    } finally { setBusy(false); }
  };

  const onAmount = async (installment, amount) => {
    setBusy(true);
    try {
      accept(await api.putInstallments(reservationId, { amounts: [{ id: installment.id, amount }] }));
      clearError(installment.id, 'amount');
    } catch (error) {
      setError(installment.id, 'amount', { message: error.message, value: amount });
    } finally { setBusy(false); }
  };

  const onSend = async (installment) => {
    setBusy(true);
    try {
      const answer = await api.sendInstallmentRequest(reservationId, installment.id);
      showSuccess(t.REQUEST_SENT(answer && answer.recipientEmail));
      if (onMoneyChanged) await onMoneyChanged();
    } catch (error) {
      fail(error);
      // specs/payment-link-lifecycle.md rule 50 — the refusal booked the installment's payment on the server.
      if (isLinkAlreadyPaid(error) && onMoneyChanged) await onMoneyChanged();
    } finally { setBusy(false); }
  };

  const onCopy = async (installment) => {
    try {
      await navigator.clipboard.writeText(installment.linkUrl);
      showSuccess(t.LINK_COPIED);
    } catch { showError(installment.linkUrl); }
  };

  const markPaid = async ({ date, method }) => {
    try {
      accept(await api.markInstallmentPaid(reservationId, markingId, { paidDate: date, method }));
      setMarkingId(null);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message, field: error.field || null };
    }
  };

  const frozenOut = disabled || busy;

  // ── No plan yet ───────────────────────────────────────────────────────────
  if (plan.installments.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, p: { xs: 1.5, sm: 2 }, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography color="text.secondary">{t.PLAN_EMPTY_LABEL}</Typography>
          {(disabled ? t.PLAN_DIRTY : plan.reason) && (
            <Typography variant="caption" color="text.secondary">{disabled ? t.PLAN_DIRTY : plan.reason}</Typography>
          )}
        </Box>
        <Button variant="contained" disabled={frozenOut || !plan.canCreate} onClick={create} sx={{ minHeight: 44, textTransform: 'none' }}>
          {t.PLAN_CREATE}
        </Button>
      </Box>
    );
  }

  const atMin = shown <= plan.minCount;
  const atMax = shown >= plan.maxCount;
  const marking = plan.installments.find((i) => i.id === markingId) || null;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', containerType: 'inline-size' }}>
      <Box
        sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 1.5, mb: 1.5,
          [HEADER_WIDE]: { flexDirection: 'row', alignItems: 'center' },
        }}
      >
        <Typography variant="sectionHeader" sx={{ flex: 1 }}>{t.PLAN_TITLE}</Typography>
        <Box
          role="group"
          aria-label={t.STEPPER_LABEL}
          sx={{ display: 'inline-flex', alignItems: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', userSelect: 'none', alignSelf: 'flex-start', [HEADER_WIDE]: { alignSelf: 'auto' } }}
        >
          <IconButton aria-label={t.STEPPER_LESS} disabled={plan.countLocked || atMin || disabled || busy} onClick={() => step(-1)} sx={{ width: 44, height: 44, borderRadius: 0, touchAction: 'manipulation' }}>
            <RemoveIcon />
          </IconButton>
          <Typography component="output" aria-live="polite" sx={{ minWidth: 118, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {t.countLabel(shown)}
          </Typography>
          <IconButton aria-label={t.STEPPER_MORE} disabled={plan.countLocked || atMax || disabled || busy} onClick={() => step(1)} sx={{ width: 44, height: 44, borderRadius: 0, touchAction: 'manipulation' }}>
            <AddIcon />
          </IconButton>
        </Box>
        {plan.countLocked
          ? <Typography variant="caption" color="text.secondary">{t.PLAN_FROZEN}</Typography>
          : (
            <Button color="inherit" disabled={frozenOut || settling} onClick={remove} sx={{ textTransform: 'none', textDecoration: 'underline', alignSelf: 'flex-start', minHeight: 44, [HEADER_WIDE]: { alignSelf: 'auto' } }}>
              {t.PLAN_DELETE}
            </Button>
          )}
      </Box>

      {disabled && <Alert severity="info" sx={{ mb: 1.5 }}>{t.PLAN_DIRTY}</Alert>}

      {confirmCount !== null && (
        <Alert
          severity="info"
          sx={{ mb: 1.5 }}
          action={(
            <Stack direction="row" spacing={0.5}>
              <Button size="small" variant="contained" onClick={() => { const next = confirmCount; setConfirmCount(null); aim(next, 0); }} sx={{ minHeight: 44, textTransform: 'none' }}>{t.RECOMPUTE_CONFIRM}</Button>
              <Button size="small" onClick={() => setConfirmCount(null)} sx={{ minHeight: 44, textTransform: 'none' }}>{t.RECOMPUTE_KEEP}</Button>
            </Stack>
          )}
        >
          {t.RECOMPUTE_WARNING(confirmCount)}
        </Alert>
      )}

      <Stack spacing={1}>
        {plan.installments.map((installment) => (
          <React.Fragment key={installment.id}>
            <InstallmentRow
              installment={installment}
              arrivalDate={plan.arrivalDate}
              dateError={errors[`${installment.id}:date`]}
              amountError={errors[`${installment.id}:amount`]}
              busy={busy || settling}
              locked={disabled}
              canRequest={plan.canRequest}
              onDate={onDate}
              onAmount={onAmount}
              onSend={onSend}
              onCopy={onCopy}
              onPay={(i) => setMarkingId(i.id)}
            />
            {marking && marking.id === installment.id && (
              <PaymentMarkForm
                row={{ action: { kind: 'mark' } }}
                today={today}
                dateLabel={t.PAY_DATE_LABEL}
                methods={t.PAY_METHODS}
                formatAmountInput={formatAmountInput}
                onSubmit={markPaid}
                onCancel={() => setMarkingId(null)}
              />
            )}
          </React.Fragment>
        ))}
      </Stack>

      {plan.gap > 0 && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          {t.GAP_LABEL} : <strong>{formatCurrency(plan.gap)}</strong>. {t.GAP_HELP}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '4px 20px', borderTop: '1px solid', borderColor: 'divider', mt: 1.5, pt: 1.5, color: 'text.secondary' }}>
        <Typography variant="body2">{t.FOOTER_TOTAL} <strong>{formatCurrency(plan.total)}</strong></Typography>
        <Typography variant="body2">{t.FOOTER_PAID} <strong>{formatCurrency(plan.paid)}</strong></Typography>
        <Typography variant="body2">{t.FOOTER_REMAINING} <strong>{formatCurrency(plan.remaining)}</strong></Typography>
      </Box>
    </Box>
  );
}
