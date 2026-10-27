/**
 * InstallmentPlanCard — the « Échéancier » of a direct reservation (specs/direct-installments.md §6).
 *
 * Renders the server's `installmentPlan` payload and posts the operator's inputs (count, dates, amounts); it
 * computes no amount, date or status (CLAUDE.md §6.0). Every change saves at once through the API, like the
 * ledger's marks, and the answer replaces the plan.
 *
 * The count stepper follows the rapid clicks: the count shown moves at once, only the final count is sent
 * once clicks stop (300 ms), and a reply older than the last click never moves it back. Its two buttons are
 * never unmounted, so a click always lands on the button actually pressed.
 *
 * Specific to the reservation fiche (a list of dated amounts nothing else edits).
 *
 * Props:
 *   reservationId:  number
 *   plan:           the `installmentPlan` payload ({ eligible, canCreate, reason, countLocked, frozen, total,
 *                   paid, remaining, gap, minCount, maxCount, count, canRequest, installments[] })
 *   arrivalDate:    `YYYY-MM-DD` — the latest date an installment may take (input bound only)
 *   today:          `YYYY-MM-DD` — the day the mark form proposes
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

const COUNT_DEBOUNCE_MS = 300;
const DEFAULT_COUNT = 3;
const BADGE = { paid: 'success', late: 'error', requested: 'info', toRequest: 'warning', upcoming: 'neutral' };

// The fiche column can be narrow even on a wide screen: the layout follows the width of the card, not the
// window's. Narrow = a two-line card (number + status, then date + amount, then the actions); wide = one line.
const WIDE = '@container (min-width: 720px)';
const rowSx = {
  display: 'grid',
  alignItems: 'center',
  columnGap: 1.5,
  rowGap: 1,
  p: 1.25,
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 2,
  gridTemplateColumns: '1fr auto',
  gridTemplateAreas: '"n badge" "date amt" "acts acts" "err err"',
  [WIDE]: {
    p: 1.5,
    gridTemplateColumns: '34px 170px 1fr auto auto',
    gridTemplateAreas: '"n date amt badge acts" ". err err err err"',
  },
};

function InstallmentRow({ installment, arrivalDate, error, busy, canRequest, onDate, onAmount, onSend, onCopy, onPay }) {
  const paid = installment.status === 'paid';
  const [draft, setDraft] = useState(String(installment.amount));
  useEffect(() => { setDraft(String(installment.amount)); }, [installment.amount]);
  const dateError = error && error.kind === 'date' ? error : null;
  const amountError = error && error.kind === 'amount' ? error : null;

  const commitAmount = () => {
    const typed = draft.trim().replace(',', '.');
    if (typed === String(installment.amount) || typed === '') {
      if (typed === '') setDraft(String(installment.amount));
      return;
    }
    onAmount(installment, typed);
  };

  return (
    <Box
      data-testid={`installment-${installment.number}`}
      sx={{
        ...rowSx,
        ...(paid ? { bgcolor: 'success.soft', borderColor: 'success.light' } : {}),
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
            value={dateError ? dateError.value : installment.dueDate}
            disabled={busy}
            error={Boolean(dateError)}
            onChange={(e) => onDate(installment, e.target.value)}
            slotProps={{ htmlInput: { 'aria-label': t.DATE_LABEL(installment.number), max: arrivalDate || undefined, 'aria-invalid': dateError ? 'true' : undefined } }}
            sx={{ '& input': { fontSize: 16 } }}
          />
        )}
      </Box>

      <Box sx={{ gridArea: 'amt', justifySelf: 'end', textAlign: 'right' }}>
        {installment.amountEditable ? (
          <TextField
            size="small"
            value={draft}
            disabled={busy}
            error={Boolean(amountError)}
            onChange={(e) => setDraft(e.target.value)}
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

      <Stack direction="row" spacing={0.75} sx={{ gridArea: 'acts', '& > button': { flex: 1 }, [WIDE]: { justifyContent: 'flex-end', '& > button': { flex: 'none' } } }}>
        {!paid && installment.linkUrl && installment.requestedAt && (
          <Button variant="outlined" onClick={() => onCopy(installment)} sx={{ minHeight: 44, textTransform: 'none' }}>{t.ACTION_COPY}</Button>
        )}
        {!paid && !installment.requestedAt && canRequest && (
          <Button variant="outlined" disabled={busy} onClick={() => onSend(installment)} sx={{ minHeight: 44, textTransform: 'none' }}>{t.ACTION_SEND}</Button>
        )}
        {!paid && (
          <Button variant="contained" disabled={busy} onClick={() => onPay(installment)} sx={{ minHeight: 44, textTransform: 'none' }}>{t.ACTION_PAY}</Button>
        )}
      </Stack>

      {(dateError || amountError) && (
        <Typography role="alert" variant="body2" color="error" sx={{ gridArea: 'err' }}>
          {(dateError || amountError).message}
        </Typography>
      )}
    </Box>
  );
}

export default function InstallmentPlanCard({ reservationId, plan, arrivalDate = '', today, onPlanChange, onMoneyChanged }) {
  const { showError, showSuccess } = useToast();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [markingId, setMarkingId] = useState(null);
  const [confirmCount, setConfirmCount] = useState(null);

  // The stepper: what the operator asked for (`wanted`), what is shown, the pending send, the last request.
  const [shown, setShown] = useState(plan.count || DEFAULT_COUNT);
  const wanted = useRef(plan.count || DEFAULT_COUNT);
  const timer = useRef(null);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const planRef = useRef(plan);
  planRef.current = plan;

  useEffect(() => {
    if (timer.current === null && !inFlight.current && plan.count) {
      wanted.current = plan.count;
      setShown(plan.count);
    }
  }, [plan.count]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const fail = useCallback((error) => showError(error && error.message ? error.message : t.GENERIC_ERROR), [showError]);

  const accept = useCallback((answer) => {
    onPlanChange(answer.installmentPlan);
    if (onMoneyChanged) onMoneyChanged();
  }, [onPlanChange, onMoneyChanged]);

  const sendCount = useCallback(async (count) => {
    timer.current = null;
    if (count === planRef.current.count) return;
    const mine = ++sequence.current;
    inFlight.current = true;
    try {
      const answer = await api.putInstallments(reservationId, { count });
      if (mine !== sequence.current || timer.current !== null) return;
      setErrors({});
      accept(answer);
    } catch (error) {
      if (mine !== sequence.current || timer.current !== null) return;
      wanted.current = planRef.current.count;
      setShown(planRef.current.count);
      fail(error);
    } finally {
      if (mine === sequence.current) inFlight.current = false;
    }
  }, [reservationId, accept, fail]);

  const aim = useCallback((count, delay = COUNT_DEBOUNCE_MS) => {
    wanted.current = count;
    setShown(count);
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
    setBusy(true);
    try {
      accept(await api.putInstallments(reservationId, { count: DEFAULT_COUNT }));
    } catch (error) { fail(error); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      accept(await api.deleteInstallments(reservationId));
      setErrors({});
    } catch (error) { fail(error); } finally { setBusy(false); }
  };

  const onDate = async (installment, dueDate) => {
    if (!dueDate) return;
    setBusy(true);
    try {
      accept(await api.putInstallments(reservationId, { dates: [{ id: installment.id, dueDate }] }));
      setErrors((prev) => { const { [installment.id]: _gone, ...rest } = prev; return rest; });
    } catch (error) {
      setErrors((prev) => ({ ...prev, [installment.id]: { kind: 'date', message: error.message, value: dueDate } }));
    } finally { setBusy(false); }
  };

  const onAmount = async (installment, amount) => {
    setBusy(true);
    try {
      accept(await api.putInstallments(reservationId, { amounts: [{ id: installment.id, amount }] }));
      setErrors((prev) => { const { [installment.id]: _gone, ...rest } = prev; return rest; });
    } catch (error) {
      setErrors((prev) => ({ ...prev, [installment.id]: { kind: 'amount', message: error.message } }));
    } finally { setBusy(false); }
  };

  const onSend = async (installment) => {
    setBusy(true);
    try {
      const answer = await api.sendInstallmentRequest(reservationId, installment.id);
      showSuccess(t.REQUEST_SENT(answer && answer.recipientEmail));
      if (onMoneyChanged) await onMoneyChanged();
    } catch (error) { fail(error); } finally { setBusy(false); }
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

  // ── No plan yet ───────────────────────────────────────────────────────────
  if (plan.installments.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, p: { xs: 1.5, sm: 2 }, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography color="text.secondary">{t.PLAN_EMPTY_LABEL}</Typography>
          {plan.reason && <Typography variant="caption" color="text.secondary">{plan.reason}</Typography>}
        </Box>
        <Button variant="contained" disabled={busy || !plan.canCreate} onClick={create} sx={{ minHeight: 44, textTransform: 'none' }}>
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
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { xs: 'stretch', sm: 'center' }, mb: 1.5 }}>
        <Typography variant="sectionHeader" sx={{ flex: 1 }}>{t.PLAN_TITLE}</Typography>
        <Box
          role="group"
          aria-label={t.STEPPER_LABEL}
          sx={{ display: 'inline-flex', alignItems: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', userSelect: 'none', alignSelf: { xs: 'flex-start', sm: 'auto' } }}
        >
          <IconButton aria-label={t.STEPPER_LESS} disabled={plan.countLocked || atMin} onClick={() => step(-1)} sx={{ width: 44, height: 44, borderRadius: 0, touchAction: 'manipulation' }}>
            <RemoveIcon />
          </IconButton>
          <Typography component="output" aria-live="polite" sx={{ minWidth: 118, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {t.countLabel(shown)}
          </Typography>
          <IconButton aria-label={t.STEPPER_MORE} disabled={plan.countLocked || atMax} onClick={() => step(1)} sx={{ width: 44, height: 44, borderRadius: 0, touchAction: 'manipulation' }}>
            <AddIcon />
          </IconButton>
        </Box>
        {plan.countLocked
          ? <Typography variant="caption" color="text.secondary">{t.PLAN_FROZEN}</Typography>
          : <Button color="inherit" disabled={busy} onClick={remove} sx={{ textTransform: 'none', textDecoration: 'underline', alignSelf: { xs: 'flex-start', sm: 'auto' }, minHeight: 44 }}>{t.PLAN_DELETE}</Button>}
      </Stack>

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
              arrivalDate={arrivalDate}
              error={errors[installment.id]}
              busy={busy}
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
