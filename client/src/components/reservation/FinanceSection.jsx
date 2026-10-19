import React, { useState } from 'react';
import { Box, Card, CardContent, Typography, Stack, Divider, Grid, TextField, Button, Switch, FormControlLabel, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import api from '../../api';
import ArithmeticTextField from '../ArithmeticTextField';
import DateField from '../DateField';
import StatusBadge from '../StatusBadge';
import MidStayNoteDialog from './MidStayNoteDialog';
import MidStayNoteRow from './MidStayNoteRow';
import RefundDialog from './RefundDialog';
import PaymentMarkForm from './PaymentMarkForm';
import PlatformStatementEditor from './PlatformStatementEditor';
import LedgerList from '../LedgerList';
import LedgerAmountEditor from '../LedgerAmountEditor';
import { useAppDialogs, useToast } from '../DialogProvider';
import { useReservationForm } from './ReservationFormContext';
import { formatCurrency, formatAmountInput, displayDate } from '../../utils/formatters';
import { complementDeferralAccess } from '../../utils/complementDeferralAccess';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The end-of-stay complement breakdown is stored as a JSON array string ([{ label, amount }]) by the
// departure SAS. Parse defensively for read-only display (accepts an already-parsed array too).
function parseEndOfStayDetail(detail) {
  if (!detail) return [];
  if (Array.isArray(detail)) return detail;
  try {
    const parsed = JSON.parse(detail);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * ArrivalPaymentCard — le paiement unique de l'arrivée, détaillé
 * (specs/arrival-payment-detail-and-adjustment.md §3.1-§3.2).
 *
 * Le groupe dit QUELS SEAUX une même collecte a couverts ; cette carte dit ce que le client a payé :
 * les nuits, le linge, le repas, la taxe de séjour, puis le total. Les lignes viennent du serveur
 * telles quelles — leur ordre, leurs libellés et leurs montants sont sa décision, pas la nôtre.
 *
 * Le champ « Total encaissé » porte le seul geste éditable du bloc : en dessous du calcul, l'écart
 * devient une « Réduction accordée » imputée sur l'hébergement ; au-dessus, un « Pourboire ». Le
 * serveur dérive et borne les deux ; ici on ne fait que transmettre le montant saisi.
 *
 * Props : `payment` (la charge utile `arrivalPayment`), `busy`, `error`, `readOnly`,
 * `onCommitTotal(value)` et `onUndo()`.
 */
function ArrivalPaymentCard({ payment, busy, error, readOnly, onCommitTotal, onUndo }) {
  const lines = payment.lines || [];
  const reduction = Number(payment.reduction || 0);
  const tip = Number(payment.tip || 0);
  const adjusted = reduction > 0 || tip > 0;
  const bucketsTotal = Number(payment.bucketsTotal ?? payment.total);
  const accommodation = Number(payment.accommodation || 0);
  // Le plancher est atteint quand la réduction a mangé tout l'hébergement : le dire, plutôt que de
  // laisser l'opérateur croire que sa saisie a été ignorée.
  const atFloor = reduction > 0 && Number(payment.total) <= Number(payment.floor || 0) + 0.005;
  const helper = atFloor
    ? `Réduction maximale ${formatCurrency(accommodation)} : elle ne peut pas dépasser l'hébergement.`
    : `Calcul auto (${formatCurrency(bucketsTotal)})`;

  const lineLabel = (l) => {
    const qty = Number(l.qty || 0);
    const unit = Number(l.unitPrice || 0);
    return qty > 1 && unit > 0 ? `${l.label} · ${qty} × ${formatCurrency(unit)}` : l.label;
  };

  return (
    <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        Encaissé à l'arrivée : paiement unique de {formatCurrency(payment.total)}
        {' '}le {displayDate(payment.at)} — {payment.means}
      </Typography>
      {payment.cash && (
        <Typography variant="caption" color="text.secondary">Hors comptabilité (caisse interne).</Typography>
      )}
      {/* Sans détail — un seau dont l'attribution n'a jamais été capturée, une charge utile d'avant
          cette spec — on retombe sur la légende par seau : dégradé, jamais inventé. */}
      {lines.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {(payment.covers || []).map((c) => `${c.label} ${formatCurrency(c.amount)}`).join(' · ')}
        </Typography>
      )}
      {lines.length > 0 && (
        <Stack spacing={0.25} sx={{ mt: 1 }}>
          {lines.map((l, i) => (
            <Box key={`${l.kind}-${i}`} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">{lineLabel(l)}</Typography>
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, whiteSpace: 'nowrap', color: l.offered ? 'success.main' : 'inherit' }}
              >
                {l.offered && Number(l.originalAmount || 0) > 0 && (
                  <Box component="span" sx={{ textDecoration: 'line-through', color: 'text.disabled', mr: 0.5 }}>
                    {formatCurrency(l.originalAmount)}
                  </Box>
                )}
                {formatCurrency(l.amount)}
              </Typography>
            </Box>
          ))}
          {reduction > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">Réduction accordée</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'warning.main' }}>
                − {formatCurrency(reduction)}
              </Typography>
            </Box>
          )}
          {tip > 0 && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">Pourboire</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'success.main' }}>
                + {formatCurrency(tip)}
              </Typography>
            </Box>
          )}
          <Divider sx={{ my: 0.5 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>Total encaissé</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
              {formatCurrency(payment.total)}
            </Typography>
          </Box>
        </Stack>
      )}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{ mt: 1, alignItems: { sm: 'flex-start' } }}
      >
        {!readOnly && (
          <ArithmeticTextField
            label="Total encaissé"
            value={adjusted ? payment.total : ''}
            onCommit={onCommitTotal}
            size="small"
            disabled={busy}
            error={Boolean(error)}
            helperText={error || helper}
            sx={{ maxWidth: { sm: 220 }, width: { xs: '100%', sm: 'auto' } }}
          />
        )}
        {/* specs/single-payment-from-the-fiche.md rule 10 — undoing releases exactly the buckets the
            group named; one paid outside it is never touched. */}
        <Button
          size="small"
          variant="text"
          disabled={busy}
          onClick={onUndo}
          sx={{
            textTransform: 'none', px: 0, minHeight: 44,
            alignSelf: { xs: 'flex-start', sm: 'center' },
          }}
        >
          Annuler ce paiement
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * ComplementDetail — what sits under a complement row of the ledger, folded under « Détail »
 * (specs/reservation-payment-ledger.md rule 22, §9 Q5): the itemised lines, the operator's adjusted
 * amount with its accounting split, and an optional `extra` node (« Percevoir en fin de séjour »).
 * Marking it perceived is the row's own action now. Shared by the arrival, end-of-stay and merged
 * complements (specs/defer-arrival-complement-to-checkout.md §3.2), so they can never drift apart.
 *
 * Props: `lines` ([{ label, amount }]), the adjustment (`overrideValue`, `onOverrideCommit`,
 * `autoAmount`, `allocation`, `floor`, `adjustDisabledReason`) and `extra`.
 */
function ComplementDetail({
  lines = [], overrideValue, onOverrideCommit, autoAmount, allocation = null, floor = null, adjustDisabledReason = '',
  extra = null,
}) {
  const adjusted = overrideValue !== '' && overrideValue != null;
  const adjustable = typeof onOverrideCommit === 'function';
  const atFloor = adjusted && floor != null && Number(floor) > 0
    && Number(overrideValue) <= Number(floor) + 0.005;
  const helper = adjustDisabledReason
    || (atFloor
      ? `Minimum ${formatCurrency(floor)} : taxe de séjour et hébergement ne sont pas ajustables.`
      : adjusted
        ? "Montant figé — l'écart est absorbé par le total du séjour."
        : `Calcul auto (${formatCurrency(autoAmount)})`);
  return (
    <Box sx={{ mt: 1, pl: 1.5, borderLeft: '2px solid', borderColor: 'divider', display: 'grid', gap: 1 }}>
      {lines.length > 0 && (
        <Box>
          {lines.map((line, i) => (
            <Typography key={i} variant="body2" sx={{ color: 'text.secondary' }}>
              {line.label} : {formatCurrency(line.amount || 0)}
            </Typography>
          ))}
        </Box>
      )}
      {adjustable && (
        <Box>
          {/* specs/adjustable-complement-amounts.md §3.1 — le montant annoncé au client l'emporte sur
              le calcul, même après encaissement. Vider le champ rend la main au moteur. */}
          <Tooltip title={adjustDisabledReason} disableHoverListener={!adjustDisabledReason}>
            <span>
              <ArithmeticTextField
                label="Montant ajusté (€)"
                value={overrideValue == null ? '' : overrideValue}
                onCommit={(v) => onOverrideCommit(v)}
                disabled={Boolean(adjustDisabledReason)}
                size="small"
                helperText={helper}
                sx={{ maxWidth: { sm: 280 }, width: '100%' }}
              />
            </span>
          </Tooltip>
          {/* §3.6 — ce qui partira en comptabilité, poste par poste. */}
          {adjusted && allocation && (
            <Box sx={{ mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600 }}>
                Ventilation comptable
              </Typography>
              {allocation.map((poste) => (
                <Typography key={poste.label} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {poste.label} : {formatCurrency(poste.amount)}{poste.locked ? ' (inchangé)' : ''}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
      )}
      {extra}
    </Box>
  );
}

// What the PATCH flips for each ledger row (specs/reservation-payment-ledger.md rules 8, 14).
const MARK_FIELDS = {
  deposit: { flag: 'depositPaid', date: 'depositPaidDate' },
  balance: { flag: 'balancePaid', date: 'balancePaidDate' },
  complement: { flag: 'complementPaid', date: 'complementPaidDate', cash: 'complementPaidCash' },
  checkoutComplement: { flag: 'complementPaid', date: 'complementPaidDate', cash: 'complementPaidCash' },
  endOfStayComplement: { flag: 'endOfStayComplementPaid', date: 'endOfStayComplementPaidDate', cash: 'endOfStayComplementPaidCash' },
  cautionReceived: { flag: 'cautionReceived', date: 'cautionReceivedDate' },
  cautionReturned: { flag: 'cautionReturned', date: 'cautionReturnedDate' },
};
const LOCKED_AMOUNT_REASON = 'Séjour commencé : déverrouiller la fiche pour modifier les montants.';
const AMOUNT_ROWS = new Set(['deposit', 'balance', 'complement', 'checkoutComplement', 'endOfStayComplement']);
const EDITOR_LABELS = { deposit: "Montant de l'acompte (€)", balance: 'Montant du solde (€)' };

/**
 * Finance card: the price block (« Prix hébergement brut / ajusté ») and the payments ledger
 * (specs/reservation-payment-ledger.md). Every row, state, amount, action and refusal comes from the
 * server (`ledger`); this component keeps only which panel is open and the drafts. Reads everything
 * from the reservation form context — no props.
 */
export default function FinanceSection() {
  const {
    formSectionCardSx, formSectionContentSx, sectionGridSx,
    form, updateForm, pricingQuote, accommodationBasePriceDisplay,
    isDevisMode, reservationId, editingReservationId, isReservationLocked, refreshToCurrentPricing,
    saveThenRun, reloadReservationFinance,
    midStayNoteOpen, setMidStayNoteOpen, midStayNote,
    refundableLines = [], refundCollectedTtc = 0,
    refundOverpaymentTtc = 0,
    refundOverpaymentLines = [],
    refundDialogOpen, setRefundDialogOpen, createRefund, deleteRefund,
    // specs/reservation-payment-ledger.md — the ledger and its three server round-trips.
    ledger = null, checkLedgerEdit, applyLedgerPatch, markFromLedger, resendPaymentRequest,
  } = useReservationForm();
  const { confirm } = useAppDialogs();
  const { showError } = useToast();
  const [arrivalPayDate, setArrivalPayDate] = useState(todayStr());
  const [arrivalPayBusy, setArrivalPayBusy] = useState(false);
  const [arrivalPayError, setArrivalPayError] = useState('');
  // The one open panel under a row: { key, kind: 'mark' | 'edit' | 'statement' | 'locked' }.
  const [panel, setPanel] = useState(null);
  // Rule 41 — the date of a payment undone in this visit, proposed again when it is redone.
  const [undoneDates, setUndoneDates] = useState({});
  const [folds, setFolds] = useState(() => new Set());
  const toggleFold = (key) => setFolds((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // specs/defer-arrival-complement-to-checkout.md §3.2 — the merged block lives on the live quote.
  const checkoutComplement = pricingQuote?.checkoutComplement || form.checkoutComplement || null;
  const complementDeferred = Boolean(checkoutComplement?.deferred)
    && Number(checkoutComplement?.amount || 0) > 0;
  const complementAdjustment = form.complementAdjustment || { floor: 0, accommodation: 0, tax: 0, allocation: null };
  const arrivalAdjusted = form.complementAmountOverride !== '' && form.complementAmountOverride != null;
  const arrivalAutoAmount = Number(pricingQuote?.complementAmountAuto || 0);
  const endOfStayLiveTotal = pricingQuote?.endOfStayComplementTotal;
  const endOfStayAmountNow = endOfStayLiveTotal != null
    ? Number(endOfStayLiveTotal)
    : Number(form.endOfStayComplementAmount || 0);
  const storedEndOfStayLines = parseEndOfStayDetail(form.endOfStayComplementDetail);
  const endOfStayLines = pricingQuote?.midStayExtrasLines
    ? [
      ...storedEndOfStayLines.filter((l) => l && l.source !== 'midStayExtra'),
      ...pricingQuote.midStayExtrasLines,
    ]
    : storedEndOfStayLines;
  // §3.6 règle 34 — un complément fait uniquement d'hébergement n'a rien à ventiler.
  const arrivalAdjustDisabledReason = (!arrivalAdjusted
    && arrivalAutoAmount > 0
    && Number(complementAdjustment.tax || 0) === 0
    && Number(complementAdjustment.floor || 0) >= arrivalAutoAmount - 0.005)
    ? 'Ce complément ne contient que de l\'hébergement. Pour le réduire, utilisez « Prix hébergement ajusté ».'
    : '';
  // §3.5 règles 29-30 — sur la ligne fusionnée l'opérateur saisit le TOTAL ; l'ajustement stocké reste
  // celui du complément d'ARRIVÉE.
  const mergedAutoAmount = Math.round((arrivalAutoAmount + endOfStayAmountNow) * 100) / 100;
  const mergedFloor = Math.round((Number(complementAdjustment.floor || 0) + endOfStayAmountNow) * 100) / 100;
  const commitArrivalOverride = (v) => {
    if (v === '' || v == null) { updateForm({ complementAmountOverride: '' }); return; }
    const floor = complementDeferred ? mergedFloor : Number(complementAdjustment.floor || 0);
    const target = Math.max(floor, Number(v));
    const stored = complementDeferred ? Math.max(0, Math.round((target - endOfStayAmountNow) * 100) / 100) : target;
    updateForm({ complementAmountOverride: stored });
  };
  const mergedOverrideValue = arrivalAdjusted
    ? Math.round((Number(form.complementAmountOverride) + endOfStayAmountNow) * 100) / 100
    : '';

  // specs/defer-arrival-complement-to-checkout.md §3.3 — « Percevoir en fin de séjour ».
  const deferAccess = complementDeferralAccess({
    editingReservationId,
    isDevisMode,
    complementAmount: Number(pricingQuote?.complementAmount || 0),
    complementPaid: Boolean(form.complementPaid) || Boolean(form.complementPaidCash),
    deferred: Boolean(form.complementDeferredToCheckout),
    locked: Boolean(isReservationLocked),
  });
  const onToggleDefer = async (next) => {
    if (next && deferAccess.needsConfirm) {
      const ok = await confirm({
        title: 'Reporter ce complément au départ ?',
        message: 'Il est marqué encaissé. Le reporter le remet à percevoir, avec le complément de fin de séjour, en une seule collecte.',
      });
      if (!ok) return;
    }
    updateForm({
      complementDeferredToCheckout: next,
      ...(next && deferAccess.needsConfirm ? { complementPaid: false, complementPaidCash: false, complementPaidDate: '' } : {}),
    });
    await api.markPayment(editingReservationId, {
      complementDeferredToCheckout: next,
      ...(next && deferAccess.needsConfirm ? { complementPaid: false, complementPaidCash: false } : {}),
    });
    await reloadReservationFinance();
  };
  const deferButton = deferAccess.visible ? (
    <Tooltip
      title={deferAccess.reason
        || (deferAccess.checked
          ? 'Le complément d\'arrivée est encaissé au départ, avec le complément de fin de séjour — une seule collecte.'
          : 'Regrouper ce complément avec celui de fin de séjour : une seule ligne, un seul encaissement.')}
    >
      <span style={{ display: 'block' }}>
        <Button
          size="small"
          variant={deferAccess.checked ? 'contained' : 'outlined'}
          color={deferAccess.checked ? 'info' : 'inherit'}
          disabled={deferAccess.disabled}
          onClick={() => onToggleDefer(!deferAccess.checked)}
          sx={{ textTransform: 'none', minHeight: 44 }}
        >
          {deferAccess.checked ? 'Perçu en fin de séjour ✓' : 'Percevoir en fin de séjour'}
        </Button>
      </span>
    </Tooltip>
  ) : null;

  const isPlatform = String(form.platform || 'direct').toLowerCase() !== 'direct';
  const midStayNotes = parseEndOfStayDetail(form.midStaySettledNotes);
  const endOfStaySettled = Boolean(form.endOfStayComplementPaid) || Boolean(form.endOfStayComplementPaidCash);
  const showMidStayNotes = Boolean(midStayNote?.visible);
  const pendingMidStayLines = parseEndOfStayDetail(form.endOfStayComplementDetail)
    .filter((l) => l && l.source === 'midStayExtra' && Number(l.amount) > 0);

  const runArrivalPayment = async (mode) => {
    if (!editingReservationId) return;
    setArrivalPayBusy(true);
    setArrivalPayError('');
    try {
      await api.settleArrivalPayment(editingReservationId, mode, arrivalPayDate);
      await reloadReservationFinance();
    } catch (err) {
      setArrivalPayError(err?.message || 'L\'encaissement n\'a pas pu être enregistré.');
    } finally {
      setArrivalPayBusy(false);
    }
  };
  const commitArrivalTotal = async (value) => {
    if (!editingReservationId) return;
    setArrivalPayBusy(true);
    setArrivalPayError('');
    try {
      await api.adjustArrivalPayment(editingReservationId, value === '' || value == null ? null : Number(value));
      await reloadReservationFinance();
    } catch (err) {
      setArrivalPayError(err?.message || 'Le total encaissé n\'a pas pu être enregistré.');
    } finally {
      setArrivalPayBusy(false);
    }
  };

  const onAdjustNote = async (note, patch) => {
    await api.markPayment(editingReservationId, { adjustMidStayNote: { id: note.id, ...patch } });
    await reloadReservationFinance();
  };
  const onCancelNote = async (note) => {
    const ok = await confirm({
      title: 'Reporter cette note au départ ?',
      message: 'Ses prestations rejoignent le complément de fin de séjour, à encaisser en une seule fois. La note disparaît du registre.',
    });
    if (!ok) return;
    await api.markPayment(editingReservationId, { cancelMidStayNote: { id: note.id } });
    await reloadReservationFinance();
  };

  // ── Ledger actions (rules 8-14, 19, 25-26, 28) ─────────────────────────────
  const rows = ledger?.rows || [];
  // Closing a panel gives the focus back to what opened it (the amount, or the row's action).
  const close = () => {
    const key = panel && panel.key;
    setPanel(null);
    if (key) {
      setTimeout(() => {
        const row = document.querySelector(`[data-row="${key}"]`);
        const target = row && (row.querySelector('[data-ledger-amount]') || row.querySelector('[data-ledger-action]'));
        if (target) target.focus();
      }, 0);
    }
  };

  const onAction = async (row) => {
    const action = row.action || {};
    if (action.kind === 'mark') { setPanel({ key: row.key, kind: 'mark' }); return; }
    if (action.kind === 'refund') {
      setRefundDialogOpen({ overpaymentTtc: refundOverpaymentTtc, overpaymentLines: refundOverpaymentLines });
      return;
    }
    if (action.kind === 'deleteRefund') {
      const ok = await confirm({ title: 'Supprimer ce remboursement ?', message: 'L\'avoir correspondant sera supprimé.', confirmColor: 'error' });
      if (ok) await deleteRefund(action.refundId);
      return;
    }
    if (action.kind === 'undo') {
      // §9 Q4 — the confirmation names the date and the accounting entry (server wording).
      const ok = await confirm({ title: `${action.confirmLabel || 'Annuler la perception'} ?`, message: action.confirm, confirmLabel: action.confirmLabel || 'Annuler la perception', cancelLabel: 'Garder' });
      if (!ok) return;
      const fields = MARK_FIELDS[row.key];
      if (!fields) return;
      try {
        await api.markPayment(editingReservationId, { [fields.flag]: false, ...(fields.cash ? { [fields.cash]: false } : {}) });
        if (row.paidDate) setUndoneDates((prev) => ({ ...prev, [row.key]: row.paidDate }));
        await reloadReservationFinance();
      } catch (err) {
        showError(err.message || 'Annulation impossible.');
      }
    }
  };

  const onAmountClick = (row) => {
    const mode = row.amountEdit?.mode;
    // Review of #727 (M1) — on a past, locked fiche the amounts and the split are read-only; only the
    // marks stay. The complement detail still unfolds.
    if (isReservationLocked && mode !== 'complement') { setPanel({ key: row.key, kind: 'locked', reason: LOCKED_AMOUNT_REASON }); return; }
    if (mode === 'complement') { toggleFold(row.key); return; }
    if (mode === 'statement') { setPanel({ key: row.key, kind: 'statement' }); return; }
    if (mode === 'locked') { setPanel({ key: row.key, kind: 'locked' }); return; }
    setPanel({ key: row.key, kind: 'edit' });
  };

  const submitMark = async (row, { date, cash, payout, commission }) => {
    const fields = MARK_FIELDS[row.key];
    const body = { [fields.flag]: true, [fields.date]: date };
    if (cash && fields.cash) body[fields.cash] = true;
    // Rule 11 — the amount the operator saw, to the cent.
    if (AMOUNT_ROWS.has(row.key) && row.amount != null) body.expectedAmountCents = Math.round(Number(row.amount) * 100);
    // Rule 34 — the transfer (and the commission, if taken) ride the mark: no full save of the fiche.
    if (payout != null) {
      body.platformPayoutAmount = payout;
      if (commission != null) body.platformCommissionAmount = commission;
    }
    const res = await markFromLedger(body);
    if (res && res.ok) close();
    return res;
  };

  const renderDetail = (row) => {
    const d = row.detail || {};
    const bits = [];
    if (d.commission) bits.push(<span key="c">{d.commission}</span>);
    if (d.hint) bits.push(<span key="h">{d.hint}</span>);
    if (d.link) bits.push(<span key="l">{d.link.label}</span>);
    if (d.pending) bits.push(<span key="p">{d.pending}</span>);
    const warnings = d.warnings || [];
    const lines = d.lines || [];
    const slot = d.slot;
    const foldable = Boolean(slot) || row.state === 'paid-group';
    const groupFirst = row.state === 'paid-group' && rows.find((r) => r.state === 'paid-group')?.key === row.key;
    const hasFold = slot || (groupFirst && form.arrivalPayment?.covers);
    if (bits.length === 0 && warnings.length === 0 && lines.length === 0 && !d.reconciliation && !d.note && !hasFold && !d.link?.resend) return null;
    const open = folds.has(row.key);
    return (
      <Box sx={{ mt: 0.5 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, columnGap: 1.25, alignItems: 'center', color: 'text.secondary', fontSize: '0.8125rem' }}>
          {bits.map((b, i) => <React.Fragment key={b.key}>{i > 0 && <span aria-hidden>·</span>}{b}</React.Fragment>)}
          {d.link?.resend && !isReservationLocked && (
            <Button size="small" variant="text" onClick={() => resendPaymentRequest(d.link.resend.type)} sx={{ minHeight: 44, textTransform: 'none' }}>
              {d.link.resend.label}
            </Button>
          )}
          {d.reconciliation && <StatusBadge status={d.reconciliation.tone === 'done' ? 'success' : 'warning'} label={d.reconciliation.label} />}
          {warnings.map((w) => <StatusBadge key={w.label} status="warning" label={w.label} wrap />)}
          {foldable && hasFold && (
            <Button size="small" variant="text" onClick={() => toggleFold(row.key)} aria-expanded={open} sx={{ minHeight: 44, textTransform: 'none' }}>
              {open ? 'Masquer le détail' : 'Détail'}
            </Button>
          )}
        </Box>
        {lines.map((l) => <Typography key={l} variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{l}</Typography>)}
        {d.note && <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>{d.note}</Typography>}
        {open && slot === 'complement' && (
          <ComplementDetail
            overrideValue={form.complementAmountOverride}
            onOverrideCommit={commitArrivalOverride}
            autoAmount={arrivalAutoAmount}
            allocation={complementAdjustment.allocation}
            floor={complementAdjustment.floor}
            adjustDisabledReason={arrivalAdjustDisabledReason}
            extra={deferButton}
          />
        )}
        {open && slot === 'checkoutComplement' && (
          <ComplementDetail
            lines={checkoutComplement?.lines || []}
            overrideValue={mergedOverrideValue}
            onOverrideCommit={commitArrivalOverride}
            autoAmount={mergedAutoAmount}
            allocation={complementAdjustment.allocation}
            floor={mergedFloor}
            adjustDisabledReason={arrivalAdjustDisabledReason}
            extra={deferButton}
          />
        )}
        {open && slot === 'endOfStayComplement' && (
          <ComplementDetail
            lines={endOfStayLines}
            overrideValue={form.endOfStayComplementAmountOverride}
            onOverrideCommit={(v) => updateForm({ endOfStayComplementAmountOverride: v })}
            autoAmount={pricingQuote?.endOfStayComplementAutoTotal != null
              ? pricingQuote.endOfStayComplementAutoTotal
              : form.endOfStayComplementAmountAuto}
          />
        )}
        {open && slot === 'midStayNotes' && (
          <Box sx={{ mt: 1, pl: 1.5, borderLeft: '2px solid', borderColor: 'divider' }}>
            {midStayNotes.map((note) => (
              <MidStayNoteRow
                key={note.id}
                note={note}
                settled={endOfStaySettled}
                onCancel={() => onCancelNote(note)}
                onAdjust={(patch) => onAdjustNote(note, patch)}
              />
            ))}
          </Box>
        )}
        {open && groupFirst && form.arrivalPayment?.covers && (
          <Box sx={{ mt: 1 }}>
            <ArrivalPaymentCard
              payment={form.arrivalPayment}
              busy={arrivalPayBusy}
              error={arrivalPayError}
              readOnly={isReservationLocked}
              onCommitTotal={commitArrivalTotal}
              onUndo={() => runArrivalPayment('undo')}
            />
          </Box>
        )}
      </Box>
    );
  };

  const renderPanel = (row) => {
    if (!panel || panel.key !== row.key) return null;
    if (panel.kind === 'mark') {
      return (
        <PaymentMarkForm
          row={row}
          today={todayStr()}
          dateLabel={row.action?.dateLabel || 'Perçu le'}
          previousDate={undoneDates[row.key] || null}
          onSubmit={(values) => submitMark(row, values)}
          onCancel={close}
          formatAmountInput={formatAmountInput}
          checkPayout={(payout) => api.computePlatformCommission({
            gross: form.platformGrossAmount,
            payout,
            touristTax: form.platformTouristTaxAmount,
            acompteCommission: form.acompteCommissionAmount,
            expectedNet: row.action.payout.expected,
            forMark: true,
            taxEstimate: pricingQuote?.touristTaxOriginalTotal ?? form.touristTaxTotal,
          })}
        />
      );
    }
    if (panel.kind === 'statement') {
      return (
        <PlatformStatementEditor
          form={form}
          pricingQuote={pricingQuote}
          withDepositCommission={Boolean(pricingQuote?.platformTakesDeposit)}
          locked={isReservationLocked}
          computeCommission={api.computePlatformCommission}
          onError={showError}
          onApply={(patch) => { updateForm(patch); close(); }}
          onCancel={close}
        />
      );
    }
    if (panel.kind === 'locked') {
      return (
        <Box sx={{ mt: 1.25, p: 1.25, borderRadius: 1.5, bgcolor: 'background.default', display: 'grid', gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{panel.reason || row.amountEdit?.reason}</Typography>
          <Box><Button variant="text" onClick={close} sx={{ minHeight: 44, textTransform: 'none' }}>Fermer</Button></Box>
        </Box>
      );
    }
    const edit = row.amountEdit || {};
    return (
      <LedgerAmountEditor
        label={EDITOR_LABELS[row.key] || 'Montant (€)'}
        initialValue={row.amount == null ? '' : formatAmountInput(row.amount)}
        help={edit.reason || edit.help || ''}
        onCheck={(raw) => checkLedgerEdit(row.key, raw)}
        onApply={(answer) => { applyLedgerPatch(answer.formPatch || {}); close(); }}
        onCancel={close}
        onRefund={(refund) => { close(); setRefundDialogOpen({ overpaymentTtc: refund.amount, overpaymentLines: null }); }}
        extraActions={edit.reset ? (
          <Button variant="text" onClick={() => { applyLedgerPatch(edit.reset.patch); close(); }} sx={{ minHeight: 44, textTransform: 'none' }}>
            {edit.reset.label}
          </Button>
        ) : null}
      />
    );
  };

  const footer = (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 1 }} sx={{ mt: 1.5, alignItems: { xs: 'flex-start', sm: 'center' }, flexWrap: 'wrap' }}>
      {showMidStayNotes && (
        <Tooltip title={midStayNote?.reason || ''}>
          <span>
            <Button variant="text" disabled={Boolean(midStayNote?.disabled)} onClick={() => setMidStayNoteOpen(true)} sx={{ minHeight: 44, textTransform: 'none' }}>
              + Nouvelle note
            </Button>
          </span>
        </Tooltip>
      )}
      {!isDevisMode && editingReservationId && (
        <Button variant="text" onClick={() => setRefundDialogOpen(true)} sx={{ minHeight: 44, textTransform: 'none' }}>
          + Nouveau remboursement
        </Button>
      )}
    </Stack>
  );

  return (
    <Card variant="outlined" sx={formSectionCardSx}>
      <CardContent sx={formSectionContentSx}>
        <Box sx={{ position: 'relative', zIndex: 10 }}>
          <Stack spacing={2}>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Typography variant="sectionHeader" sx={{ mb: 0 }}>Finance</Typography>
                {(isDevisMode || reservationId) && (
                  <Button variant="outlined" color="warning" size="small" onClick={refreshToCurrentPricing} disabled={isReservationLocked}>
                    Actualiser tarifs
                  </Button>
                )}
              </Box>

              <Grid container spacing={2} sx={{ ...sectionGridSx, alignItems: 'stretch' }}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ height: '100%', bgcolor: 'grey.50', borderColor: 'divider' }}>
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="kpiLabel" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        Prix hébergement brut
                      </Typography>
                      <Typography variant="kpiValue" sx={{ display: 'block', fontSize: '1.25rem', mt: 0.5 }}>
                        {accommodationBasePriceDisplay != null ? formatCurrency(accommodationBasePriceDisplay) : '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Tarif calculé par le serveur
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
                {!isPlatform && (
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card
                    variant="outlined"
                    sx={{
                      height: '100%',
                      borderColor: form.customPrice !== '' ? 'info.main' : 'divider',
                      bgcolor: form.customPrice !== '' ? alpha('#2196f3', 0.08) : 'background.paper',
                    }}
                  >
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                        Prix hébergement ajusté
                      </Typography>
                      {/* Accepts arithmetic (specs/reservation-price-arithmetic.md). */}
                      <ArithmeticTextField
                        label="Prix ajusté"
                        value={form.customPrice}
                        onCommit={(v) => updateForm({ customPrice: v })}
                        fullWidth
                        sx={{ mt: 1 }}
                        size="small"
                      />
                      {form.customPrice !== '' && accommodationBasePriceDisplay && (
                        <Box sx={{ mt: 1 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {pricingQuote?.accommodationDeltaType === 'reduction'
                              ? `Réduction: ${formatCurrency(pricingQuote.accommodationDeltaAmount || 0)}`
                              : pricingQuote?.accommodationDeltaType === 'increase'
                                ? `Augmentation: ${formatCurrency(pricingQuote.accommodationDeltaAmount || 0)}`
                                : 'Aucun écart'}
                          </Typography>
                        </Box>
                      )}
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1.5 }}>
                        <TextField
                          label="Réduction (%)"
                          type="number"
                          value={form.discountPercent}
                          onChange={(e) => updateForm({ discountPercent: Number(e.target.value), customPrice: '' })}
                          fullWidth
                          size="small"
                          slotProps={{ htmlInput: { min: 0, max: 100 } }}
                        />
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
                )}
              </Grid>
            </Box>

            <Divider />

            <Box>
              <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 1 }}>Paiements</Typography>

              {/* specs/single-payment-from-the-fiche.md §3.1 — several buckets still to collect: offer
                  to record them as the ONE payment the guest made. */}
              {form.arrivalPayment?.collectible && !isReservationLocked && (
                <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Encaisser en une fois : {formatCurrency(form.arrivalPayment.collectible.total)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    {form.arrivalPayment.collectible.buckets.map((b) => `${b.label} ${formatCurrency(b.amount)}`).join(' · ')}
                  </Typography>
                  <DateField
                    label="Encaissé le"
                    type="date"
                    size="small"
                    value={arrivalPayDate}
                    onChange={(e) => setArrivalPayDate(e.target.value)}
                    error={Boolean(arrivalPayError)}
                    helperText={arrivalPayError || ' '}
                    sx={{ maxWidth: 200 }}
                  />
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 0.5 }}>
                    <Button variant="outlined" disabled={arrivalPayBusy || !arrivalPayDate} onClick={() => runArrivalPayment('card')} sx={{ textTransform: 'none', minHeight: 44 }}>
                      CB / Chèque
                    </Button>
                    <Button variant="outlined" disabled={arrivalPayBusy || !arrivalPayDate} onClick={() => runArrivalPayment('cash')} sx={{ textTransform: 'none', minHeight: 44 }}>
                      Caisse interne
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    « Caisse interne » : encaissé hors comptabilité, comme un complément en liquide.
                  </Typography>
                </Box>
              )}

              <LedgerList
                rows={rows}
                closing={ledger?.closing || null}
                formatAmount={formatCurrency}
                onAction={onAction}
                onAmountClick={onAmountClick}
                renderDetail={renderDetail}
                renderPanel={renderPanel}
                openKey={panel ? panel.key : null}
                footer={footer}
              />
            </Box>

            {/* The split settings of the stay: they move money between the rows above. */}
            {(!isPlatform || Boolean(pricingQuote?.platformTakesDeposit) || (Number(pricingQuote?.touristTaxTotal || 0) > 0 && !pricingQuote?.touristTaxCollectedOnArrival)) && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }} sx={{ flexWrap: 'wrap' }}>
                {(!isPlatform || Boolean(pricingQuote?.platformTakesDeposit)) && (
                  <FormControlLabel
                    control={(
                      <Switch
                        checked={Boolean(form.depositDisabled)}
                        onChange={(e) => updateForm({
                          depositDisabled: e.target.checked,
                          // specs/disable-deposit-per-reservation.md — the server enforces the same.
                          ...(e.target.checked ? { depositPaid: false, depositPaidDate: '' } : {}),
                        })}
                        disabled={isReservationLocked && !editingReservationId}
                      />
                    )}
                    label={<Typography variant="body2">Sans acompte</Typography>}
                    sx={{ minHeight: 44, m: 0 }}
                  />
                )}
                {/* Per-item routing for the tourist tax (spec force-item-to-complement.md §6.4). */}
                {Number(pricingQuote?.touristTaxTotal || 0) > 0 && !pricingQuote?.touristTaxCollectedOnArrival && (
                  <Tooltip title="Lorsque cette option est activée, la taxe de séjour n'est pas comprise dans l'acompte ni le solde : elle est intégralement perçue dans le Complément à percevoir (par exemple, encaissée à l'arrivée)." arrow>
                    <FormControlLabel
                      control={<Switch checked={Boolean(form.touristTaxInComplement)} onChange={(e) => updateForm({ touristTaxInComplement: e.target.checked })} />}
                      label={(
                        <Typography variant="body2">
                          Taxe de séjour en complément
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                            ({formatCurrency(pricingQuote.touristTaxTotal)})
                          </Typography>
                        </Typography>
                      )}
                      sx={{ minHeight: 44, m: 0 }}
                    />
                  </Tooltip>
                )}
              </Stack>
            )}
          </Stack>
        </Box>
        {showMidStayNotes && (
          <MidStayNoteDialog
            open={Boolean(midStayNoteOpen)}
            onClose={() => setMidStayNoteOpen(false)}
            pendingLines={pendingMidStayLines}
            onSettle={(items, cash) => saveThenRun(async () => {
              await api.markPayment(editingReservationId, {
                settleMidStayNote: { items: items.map(({ key, amount }) => ({ key, amount })), cash },
              });
              await reloadReservationFinance();
            })}
            onSellOnly={() => saveThenRun(reloadReservationFinance)}
          />
        )}
        {!isDevisMode && editingReservationId && (
          <RefundDialog
            open={Boolean(refundDialogOpen)}
            onClose={() => setRefundDialogOpen(false)}
            refundableLines={refundableLines}
            collectedTtc={refundCollectedTtc}
            overpaymentTtc={refundDialogOpen && refundDialogOpen.overpaymentTtc ? refundDialogOpen.overpaymentTtc : 0}
            overpaymentLines={refundDialogOpen && refundDialogOpen.overpaymentLines ? refundDialogOpen.overpaymentLines : null}
            onSubmit={createRefund}
          />
        )}
      </CardContent>
    </Card>
  );
}
