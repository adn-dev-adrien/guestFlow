import React, { useState } from 'react';
import { Box, Card, CardContent, Typography, Stack, Divider, Grid, TextField, Button, Switch, FormControlLabel, Tooltip, IconButton, MenuItem } from '@mui/material';
import { DISCOUNT_TARGETS } from '../../constants/extraSale';
import { alpha } from '@mui/material/styles';
import api from '../../api';
import ArithmeticTextField from '../ArithmeticTextField';
import { AMOUNT_FIELD_SX } from '../../utils/amountFieldSx';
import DateField from '../DateField';
import StatusBadge from '../StatusBadge';
import MidStayNoteDialog from './MidStayNoteDialog';
import MidStayNoteRow from './MidStayNoteRow';
import { createPortal } from 'react-dom';
import RefundDialog from './RefundDialog';
import PaymentMarkForm from './PaymentMarkForm';
import TenderLines from '../TenderLines';
import { TENDER_TEXTS } from '../../constants/tenderMethods';
import PlatformStatementEditor from './PlatformStatementEditor';
import PlatformPenaltyDialog from './PlatformPenaltyDialog';
import DeleteIcon from '@mui/icons-material/Delete';
import LedgerList from '../LedgerList';
import InstallmentPlanCard from './InstallmentPlanCard';
import LedgerAmountEditor from '../LedgerAmountEditor';
import { useAppDialogs, useToast } from '../DialogProvider';
import { useReservationForm } from './ReservationFormContext';
import { formatCurrency, formatAmountInput, displayDate } from '../../utils/formatters';
import { complementDeferralAccess } from '../../utils/complementDeferralAccess';
import { localIsoToday } from '../../utils/isoDay';

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
            sx={{ maxWidth: { sm: 220 }, width: { xs: '100%', sm: 'auto' }, ...AMOUNT_FIELD_SX }}
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
                sx={{ maxWidth: { sm: 280 }, width: '100%', ...AMOUNT_FIELD_SX }}
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
const DEPOSIT_DISABLED_LOCK_REASONS = {
  'collected-by-link': 'Acompte perçu par un lien de paiement : remboursement pour l’annuler.',
};

// specs/force-item-to-complement.md rule 20.
const TAX_IN_COMPLEMENT_LOCK_REASONS = {
  'collected-on-solde': 'Taxe encaissée avec le solde : décocher le solde d’abord.',
  'collected-on-acompte': 'Taxe encaissée avec l’acompte : décocher l’acompte d’abord.',
  'collected-on-installment': 'Taxe encaissée avec une échéance.',
};

export default function FinanceSection() {
  const {
    formSectionCardSx, formSectionContentSx, sectionGridSx,
    form, updateForm, pricingQuote, accommodationBasePriceDisplay, isPlatformSale,
    isDevisMode, reservationId, editingReservationId, isReservationLocked, refreshToCurrentPricing,
    saveThenRun, reloadReservationFinance,
    midStayNoteOpen, setMidStayNoteOpen, midStayNote,
    refundableLines = [], refundCollectedTtc = 0,
    refundOverpaymentTtc = 0,
    refundOverpaymentLines = [],
    refundDialogOpen, setRefundDialogOpen, createRefund, deleteRefund,
    // A cancelled fiche is a disabled fieldset, yet a refund is still its legitimate write
    // (specs/calendar-property-parity.md rule 25): the button goes through a portal to a node outside it.
    refundHost = null,
    // specs/payment-link-lifecycle.md rule 56 (O2) — on a closed fiche, where « Marquer remboursé » is drawn instead.
    closedActionsHost = null,
    // specs/reservation-payment-ledger.md — the ledger and its three server round-trips.
    ledger = null, checkLedgerEdit, applyLedgerPatch, markFromLedger, resendPaymentRequest, withdrawPaymentLink, settlePaymentLink,
    // specs/direct-installments.md — the plan of a direct reservation and its setter.
    installmentPlan = null, setInstallmentPlan, fichePristine = true,
    // specs/disable-deposit-per-reservation.md rule 13 — why « Sans acompte » cannot be ticked, from the server.
    depositDisabledLockedReason = null,
    touristTaxInComplementLockedReason = null,
  } = useReservationForm();
  const depositDisabledLockReason = DEPOSIT_DISABLED_LOCK_REASONS[depositDisabledLockedReason] || null;
  const taxInComplementLockReason = form.touristTaxInComplement ? null : (TAX_IN_COMPLEMENT_LOCK_REASONS[touristTaxInComplementLockedReason] || null);
  const { confirm } = useAppDialogs();
  const { showError, showSuccess } = useToast();
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [arrivalPayDate, setArrivalPayDate] = useState(todayStr());
  const [arrivalPayBusy, setArrivalPayBusy] = useState(false);
  const [arrivalPayError, setArrivalPayError] = useState('');
  // specs/mixed-method-payments.md rules 21-22 — « Plusieurs moyens » on the single payment, closed by default.
  const [arrivalSplitOpen, setArrivalSplitOpen] = useState(false);
  const [arrivalTenders, setArrivalTenders] = useState(null);
  // Rules 17, 20, 41 — the inline form under a recorded split payment: { rowKey, kind: 'modify' | 'remainder', settlementId?, target? }.
  const [splitPanel, setSplitPanel] = useState(null);
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
  // Règle 22 (defer-arrival-complement-to-checkout) — la carte fusionnée ne porte que la fin de séjour encore due : le
  // bloc du serveur dit laquelle.
  const mergedEndOfStay = complementDeferred ? Number(checkoutComplement.endOfStayAmount || 0) : endOfStayAmountNow;
  const mergedAutoAmount = Math.round((arrivalAutoAmount + mergedEndOfStay) * 100) / 100;
  const mergedFloor = Math.round((Number(complementAdjustment.floor || 0) + mergedEndOfStay) * 100) / 100;
  const commitArrivalOverride = (v) => {
    if (v === '' || v == null) { updateForm({ complementAmountOverride: '' }); return; }
    const floor = complementDeferred ? mergedFloor : Number(complementAdjustment.floor || 0);
    const target = Math.max(floor, Number(v));
    const stored = complementDeferred ? Math.max(0, Math.round((target - mergedEndOfStay) * 100) / 100) : target;
    updateForm({ complementAmountOverride: stored });
  };
  const mergedOverrideValue = arrivalAdjusted
    ? Math.round((Number(form.complementAmountOverride) + mergedEndOfStay) * 100) / 100
    : '';

  // specs/defer-arrival-complement-to-checkout.md §3.3 — « Percevoir en fin de séjour ».
  const endOfStaySettled = Boolean(form.endOfStayComplementPaid) || Boolean(form.endOfStayComplementPaidCash);
  const deferAccess = complementDeferralAccess({
    editingReservationId,
    isDevisMode,
    complementAmount: Number(pricingQuote?.complementAmount || 0),
    complementPaid: Boolean(form.complementPaid) || Boolean(form.complementPaidCash),
    deferred: Boolean(form.complementDeferredToCheckout),
    locked: Boolean(isReservationLocked),
    endOfStaySettled,
  });
  const onToggleDefer = async (next) => {
    if (next && deferAccess.needsConfirm) {
      const ok = await confirm({
        title: 'Reporter ce complément au départ ?',
        message: 'Il est marqué encaissé. Le reporter le remet à percevoir, avec le complément de fin de séjour, en une seule collecte.',
      });
      if (!ok) return;
    }
    const reopens = next && deferAccess.needsConfirm;
    // R30-C-L2 — the fiche moves only once the server took the switch: a refusal is shown and the stored state re-read.
    try {
      await api.markPayment(editingReservationId, {
        complementDeferredToCheckout: next,
        ...(reopens ? { complementPaid: false, complementPaidCash: false } : {}),
      });
    } catch (err) {
      showError(err?.message || 'Report impossible.');
      await reloadReservationFinance();
      return;
    }
    updateForm({
      complementDeferredToCheckout: next,
      ...(reopens ? { complementPaid: false, complementPaidCash: false, complementPaidDate: '' } : {}),
    });
    await reloadReservationFinance();
  };
  const deferButton = deferAccess.visible ? (
    <Box>
      <Tooltip
        title={deferAccess.reason ? '' : (deferAccess.checked
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
      {deferAccess.reason ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {deferAccess.reason}
        </Typography>
      ) : null}
    </Box>
  ) : null;

  // specs/plugins-phase-p-productisation.md rule 45 — the server's answer, never the platform's name.
  const isPlatform = Boolean(isPlatformSale);
  const midStayNotes = parseEndOfStayDetail(form.midStaySettledNotes);
  const showMidStayNotes = Boolean(midStayNote?.visible);
  const pendingMidStayLines = parseEndOfStayDetail(form.endOfStayComplementDetail)
    .filter((l) => l && l.source === 'midStayExtra' && Number(l.amount) > 0);

  const runArrivalPayment = async (mode) => {
    if (!editingReservationId) return;
    setArrivalPayBusy(true);
    setArrivalPayError('');
    try {
      if (mode === 'split') {
        await api.settleArrivalPayment(editingReservationId, mode, arrivalPayDate, {
          expectedAmountCents: Math.round(Number(form.arrivalPayment?.collectible?.total || 0) * 100),
          tenders: arrivalTenders ? arrivalTenders.tenders : [],
          shortfall: arrivalTenders ? arrivalTenders.shortfall : null,
        });
      } else {
        await api.settleArrivalPayment(editingReservationId, mode, arrivalPayDate);
      }
      if (mode === 'split') setArrivalSplitOpen(false);
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
    try {
      await api.markPayment(editingReservationId, { cancelMidStayNote: { id: note.id } });
    } catch (err) {
      showError(err?.message || 'Report impossible.');
    }
    await reloadReservationFinance();
  };
  // The note's settlement runs after the fiche's save, which does not wait for it: the dialog waits here, so a refusal
  // keeps it open with the server's wording instead of closing on an unseen error. Only the settlement decides: the
  // re-read that follows is best effort, so a failed one never reports a stored settlement as refused nor leaves the
  // dialog busy (mid-stay-notes rule 24 reading R32-C-L2).
  const saveThenSettle = (settle) => new Promise((resolve, reject) => {
    Promise.resolve(saveThenRun(async () => {
      let refusal = null;
      try {
        await settle();
      } catch (err) {
        refusal = err;
        showError(err?.message || 'Encaissement impossible.');
      }
      try { await reloadReservationFinance(); } catch { /* the settlement's outcome is already known */ }
      if (refusal) reject(refusal); else resolve();
    })).then((saved) => { if (saved !== true) resolve(); }, reject);
  });

  // ── Ledger actions (rules 8-14, 19, 25-26, 28) ─────────────────────────────
  const rows = ledger?.rows || [];
  const openOverpaymentRow = rows.find((r) => r.key === 'overpayment' && r.action && r.action.kind === 'refund') || null;
  // The plan replaces the acompte and the solde: their « Sans acompte » switch has nothing to switch.
  const hasInstallmentPlan = Boolean(installmentPlan && installmentPlan.installments && installmentPlan.installments.length > 0);
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
      setRefundDialogOpen(row.refundPrefill || { overpaymentTtc: refundOverpaymentTtc, overpaymentLines: refundOverpaymentLines });
      return;
    }
    if (action.kind === 'closeObligation') {
      const ok = await confirm({ title: action.confirmTitle, message: `${row.label} : ${formatCurrency(row.amount)}`, confirmLabel: action.confirmLabel, cancelLabel: 'Annuler' });
      if (!ok) return;
      try {
        await api.closeRefundObligation(editingReservationId, action.obligationId, 'settled');
        await reloadReservationFinance();
      } catch (err) {
        showError(err?.message || 'Clôture impossible.');
      }
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

  const submitMark = async (row, { date, cash, payout, commission, tenders, shortfall }) => {
    const fields = MARK_FIELDS[row.key];
    const body = { [fields.flag]: true, [fields.date]: date };
    // specs/mixed-method-payments.md rules 1-10 — the lines replace the caisse-interne switch.
    if (tenders) {
      const res = await markFromLedger({
        ...body, expectedAmountCents: row.action.split.dueCents, tenders, ...(shortfall ? { shortfall } : {}),
      });
      if (res && res.ok) close();
      return res;
    }
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

  // Rules 24, 30 — a penalty is declared and removed where the payout is, on a locked fiche too: the server writes
  // it, the fiche only re-reads what the server moved.
  const removePenalty = async (penalty) => {
    const ok = await confirm({ title: 'Supprimer la pénalité ?', message: penalty.label, confirmLabel: 'Supprimer' });
    if (!ok) return;
    try {
      const answer = await api.removePlatformPenalty(editingReservationId, penalty.id);
      showSuccess(answer.message || 'Pénalité supprimée.');
      await reloadReservationFinance();
      close();
    } catch (err) { showError(err?.message || 'Suppression impossible.'); }
  };

  // specs/payment-link-lifecycle.md rule 42 — the server words the confirmation; the page withdraws and re-reads.
  const askWithdraw = async (withdraw) => {
    const ok = await confirm({
      title: withdraw.confirmTitle,
      message: withdraw.confirmMessage,
      confirmLabel: withdraw.confirmLabel,
      cancelLabel: 'Annuler',
      confirmColor: 'error',
    });
    if (ok) await withdrawPaymentLink(withdraw.linkId);
  };

  // Rule 56 — a payment received after a withdrawal by hand: recorded on the stay, or marked refunded.
  const askSettle = async (linkId, outcome, action) => {
    const ok = await confirm({
      title: action.confirmTitle,
      message: action.confirmMessage,
      confirmLabel: action.confirmLabel,
      cancelLabel: 'Annuler',
      confirmColor: 'primary',
    });
    if (ok) await settlePaymentLink(linkId, outcome);
  };

  // The by-hand actions the server offers on one link: withdraw it, or settle the payment it received.
  const linkActions = (link) => (
    <>
      {link.withdraw && withdrawPaymentLink && (
        <Button size="small" variant="text" onClick={() => askWithdraw(link.withdraw)} sx={{ minHeight: 44, textTransform: 'none' }}>
          {link.withdraw.label}
        </Button>
      )}
      {link.settle && settlePaymentLink && !closedActionsHost && ['stay', 'refunded'].filter((outcome) => link.settle[outcome]).map((outcome) => (
        <Button key={outcome} size="small" variant="text" onClick={() => askSettle(link.settle.linkId, outcome, link.settle[outcome])} sx={{ minHeight: 44, textTransform: 'none' }}>
          {link.settle[outcome].label}
        </Button>
      ))}
    </>
  );

  // specs/mixed-method-payments.md rules 17, 20 — a correction or a reste goes straight to the server, then the
  // fiche re-reads its money like after any other payment.
  const runSplit = async (call) => {
    try {
      await call();
      setSplitPanel(null);
      await reloadReservationFinance();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || 'Enregistrement impossible.', field: err?.field || null };
    }
  };

  // Rule 30 — one block per settlement (its lines, the caisse, the shortfall), « Modifier », and the reste.
  const renderSplit = (row) => {
    const split = row.split;
    if (!split || !Array.isArray(split.settlements) || split.settlements.length === 0) return null;
    // Audit R34-C-L1 — a panel left open on a settlement or a reste the row no longer has (undone meanwhile) is closed.
    const pointed = splitPanel && splitPanel.rowKey === row.key ? splitPanel : null;
    const stillThere = pointed && (pointed.kind === 'modify'
      ? split.settlements.some((s) => s.id === pointed.settlementId && s.edit)
      : (split.remainders || []).some((r) => `${r.targetKind}:${r.targetKey}` === pointed.target));
    const open = stillThere ? pointed : null;
    return (
      <Box sx={{ mt: 0.5, display: 'grid', gap: 1 }} data-split-row={row.key}>
        {split.settlements.map((s) => (
          <Box key={s.id} data-settlement={s.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">{s.label}</Typography>
              {s.edit && !open && (
                <Button size="small" variant="text" onClick={() => setSplitPanel({ rowKey: row.key, kind: 'modify', settlementId: s.id })} sx={{ minHeight: 44, textTransform: 'none' }}>
                  {TENDER_TEXTS.modify}
                </Button>
              )}
            </Box>
            {open && open.kind === 'modify' && open.settlementId === s.id ? (
              <PaymentMarkForm
                row={{ key: row.key, action: {} }}
                mode="modify"
                split={{ dueCents: s.edit.dueCents, methods: split.methods, whole: s.edit.whole, noCaisse: s.edit.noCaisse }}
                initialTenders={s.edit.tenders}
                initialShortfallKind={s.edit.shortfallKind}
                initialDate={s.paidDate}
                previousDate={s.paidDate}
                today={todayStr()}
                dateLabel="Perçu le"
                formatAmountInput={formatAmountInput}
                onCancel={() => setSplitPanel(null)}
                onSubmit={({ date, tenders, shortfall }) => runSplit(() => api.modifySettlement(editingReservationId, s.id, { date, tenders, shortfall }))}
              />
            ) : (
              <Box component="ul" sx={{ m: 0, pl: 2.25, color: 'text.secondary', fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums' }}>
                {s.lines.map((l) => (
                  <li key={l.label}>
                    {l.label}
                    {l.internal && <Box component="span" sx={{ ml: 1, color: 'warning.text', fontWeight: 600 }}>{TENDER_TEXTS.internalTag}</Box>}
                  </li>
                ))}
                {s.shortfall && <Box component="li" sx={{ color: 'warning.text' }}>{s.shortfall.label}</Box>}
              </Box>
            )}
          </Box>
        ))}
        {(split.overpaid || []).map((o) => (
          <Typography key={o.label} variant="body2" sx={{ p: 1.25, borderRadius: 1.5, bgcolor: 'warning.soft', color: 'warning.text', fontWeight: 600 }}>
            {o.label}
          </Typography>
        ))}
        {(split.remainders || []).map((r) => {
          const key = `${r.targetKind}:${r.targetKey}`;
          return open && open.kind === 'remainder' && open.target === key ? (
            <PaymentMarkForm
              key={key}
              row={{ key: row.key, action: {} }}
              mode="remainder"
              split={{ dueCents: r.dueCents, methods: split.methods }}
              today={todayStr()}
              dateLabel="Perçu le"
              formatAmountInput={formatAmountInput}
              onCancel={() => setSplitPanel(null)}
              onSubmit={({ date, tenders, shortfall }) => runSplit(() => api.collectSettlementRemainder(editingReservationId, {
                targetKind: r.targetKind, targetKey: r.targetKey, date, tenders, shortfall,
              }))}
            />
          ) : (
            <Box key={key} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, p: 1.25, borderRadius: 1.5, bgcolor: 'warning.soft' }}>
              <Typography variant="body2" sx={{ fontWeight: 600, color: 'warning.text' }}>{r.label}</Typography>
              {!open && (
                <Button variant="outlined" onClick={() => setSplitPanel({ rowKey: row.key, kind: 'remainder', target: key })} sx={{ minHeight: 44, borderRadius: 999, textTransform: 'none' }}>
                  Marquer payé
                </Button>
              )}
            </Box>
          );
        })}
      </Box>
    );
  };

  const renderDetail = (row) => {
    const splitBlock = renderSplit(row);
    const rest = renderDetailRest(row);
    if (!splitBlock) return rest;
    return <Box>{splitBlock}{rest}</Box>;
  };

  const renderDetailRest = (row) => {
    const d = row.detail || {};
    const bits = [];
    if (d.commission) bits.push(<span key="c">{d.commission}</span>);
    if (d.hint) bits.push(<span key="h">{d.hint}</span>);
    if (d.link) bits.push(<span key="l">{d.link.label}</span>);
    if (d.pending) bits.push(<span key="p">{d.pending}</span>);
    const warnings = d.warnings || [];
    const lines = d.lines || [];
    const penaltyLines = d.penalties || [];
    const otherLinks = d.otherLinks || [];
    const slot = d.slot;
    const foldable = Boolean(slot) || row.state === 'paid-group';
    const groupFirst = row.state === 'paid-group' && rows.find((r) => r.state === 'paid-group')?.key === row.key;
    const hasFold = slot || (groupFirst && form.arrivalPayment?.covers);
    if (bits.length === 0 && warnings.length === 0 && lines.length === 0 && penaltyLines.length === 0 && !row.penaltyAction && !d.reconciliation && !d.note && !hasFold && !d.link?.resend && !d.link?.withdraw && !d.link?.settle && otherLinks.length === 0) return null;
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
          {d.link && linkActions(d.link)}
          {d.reconciliation && <StatusBadge status={d.reconciliation.tone === 'done' ? 'success' : 'warning'} label={d.reconciliation.label} />}
          {warnings.map((w) => <StatusBadge key={w.label} status="warning" label={w.label} wrap />)}
          {foldable && hasFold && (
            <Button size="small" variant="text" onClick={() => toggleFold(row.key)} aria-expanded={open} sx={{ minHeight: 44, textTransform: 'none' }}>
              {open ? 'Masquer le détail' : 'Détail'}
            </Button>
          )}
        </Box>
        {otherLinks.map((l) => (
          <Box key={(l.withdraw || l.settle || {}).linkId || l.label} sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 1.25, alignItems: 'center', color: 'text.secondary', fontSize: '0.8125rem' }}>
            <span>{l.label}</span>
            {linkActions(l)}
          </Box>
        ))}
        {lines.map((l) => <Typography key={l} variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{l}</Typography>)}
        {penaltyLines.map((p) => (
          <Stack key={p.id} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{p.label}</Typography>
            <Tooltip title="Supprimer la pénalité">
              <span>
                <IconButton aria-label="Supprimer la pénalité" disabled={!fichePristine} onClick={() => removePenalty(p)} sx={{ minWidth: 44, minHeight: 44 }}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        ))}
        {row.penaltyAction && editingReservationId && (
          <Tooltip title={fichePristine ? '' : 'Enregistrer ou annuler les modifications avant de déclarer une pénalité.'}>
            <span>
              <Button size="small" variant="text" disabled={!fichePristine} onClick={() => setPenaltyOpen(true)} sx={{ minHeight: 44, textTransform: 'none' }}>
                {row.penaltyAction.label}
              </Button>
            </span>
          </Tooltip>
        )}
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

  // Rule 56 (O2) — a closed fiche is a disabled fieldset: the refund of a payment to settle is drawn outside it.
  const toSettle = closedActionsHost && settlePaymentLink
    ? rows.flatMap((r) => [r.detail?.link, ...(r.detail?.otherLinks || [])]).filter((l) => l && l.settle && l.settle.refunded)
    : [];
  // specs/calendar-property-parity.md rule 25 reading of 2026-11-02 — so is the deletion of a refund made after the
  // cancellation; its row in the ledger, inside the fieldset, shows no button. A duplicate set aside takes no refund.
  const toDelete = closedActionsHost && refundHost ? rows.filter((r) => r.action && r.action.kind === 'deleteRefund') : [];
  // specs/payment-schedule-and-cancellation.md rule 59 — so is the return of a caution the cancelled stay still holds.
  const toReturn = closedActionsHost && refundHost ? rows.filter((r) => r.key === 'cautionReturned' && r.action && r.action.kind === 'mark') : [];
  const drawnOutside = [...toDelete, ...toReturn];
  const ledgerRows = drawnOutside.length > 0 ? rows.map((r) => (drawnOutside.includes(r) ? { ...r, action: null } : r)) : rows;
  const returnCaution = async () => {
    const ok = await confirm({ title: 'Restituer la caution ?', message: 'Restitution datée d’aujourd’hui.', confirmLabel: 'Restituer', cancelLabel: 'Garder' });
    if (!ok) return;
    try {
      await api.markPayment(editingReservationId, { cautionReturned: true });
      await reloadReservationFinance();
    } catch (err) {
      showError(err.message || 'Restitution impossible.');
    }
  };
  const closedLineSx = { display: 'flex', flexWrap: 'wrap', columnGap: 1.25, alignItems: 'center', color: 'text.secondary', fontSize: '0.8125rem' };
  const closedLines = (toSettle.length > 0 || toDelete.length > 0 || toReturn.length > 0) ? (
    <Stack spacing={0.5}>
      {toSettle.map((l) => (
        <Box key={l.settle.linkId} sx={closedLineSx}>
          <span>{l.label}</span>
          <Button size="small" variant="text" onClick={() => askSettle(l.settle.linkId, 'refunded', l.settle.refunded)} sx={{ minHeight: 44, textTransform: 'none' }}>
            {l.settle.refunded.label}
          </Button>
        </Box>
      ))}
      {toDelete.map((r) => (
        <Box key={r.key} sx={closedLineSx}>
          <span style={{ overflowWrap: 'anywhere' }}>{`${r.label} ${formatCurrency(r.amount)} · ${r.stateLabel}`}</span>
          <Button
            size="small"
            variant="text"
            color="error"
            aria-label={`${r.action.label} : ${r.label} ${formatCurrency(r.amount)}`}
            onClick={() => onAction(r)}
            sx={{ minHeight: 44, textTransform: 'none' }}
          >
            {r.action.label}
          </Button>
        </Box>
      ))}
      {toReturn.map((r) => (
        <Box key={r.key} sx={closedLineSx}>
          <span style={{ overflowWrap: 'anywhere' }}>{`${r.label} ${formatCurrency(r.amount)} · ${r.stateLabel}`}</span>
          <Button
            size="small"
            variant="text"
            aria-label={`${r.action.label} : ${r.label} ${formatCurrency(r.amount)}`}
            onClick={returnCaution}
            sx={{ minHeight: 44, textTransform: 'none' }}
          >
            {r.action.label}
          </Button>
        </Box>
      ))}
    </Stack>
  ) : null;
  // On a cancelled fiche they follow « + Nouveau remboursement » in the same place (the footer); on a duplicate set
  // aside, which takes no refund, they stand alone.
  const closedActions = closedLines && !refundHost && createPortal(closedLines, closedActionsHost);


  const refundButton = (
    <Button variant="text" onClick={() => setRefundDialogOpen(true)} sx={{ minHeight: 44, textTransform: 'none' }}>
      + Nouveau remboursement
    </Button>
  );

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
      {!isDevisMode && editingReservationId && (refundHost ? createPortal(<>{refundButton}{closedLines}</>, refundHost) : refundButton)}
    </Stack>
  );

  return (
    <Card variant="outlined" sx={formSectionCardSx}>
      {closedActions}
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
                        sx={{ mt: 1, ...AMOUNT_FIELD_SX }}
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
                          sx={AMOUNT_FIELD_SX}
                          slotProps={{ htmlInput: { min: 0, max: 100 } }}
                        />
                        <TextField
                          select
                          label="Réduction sur"
                          value={form.discountTarget || 'nights'}
                          onChange={(e) => updateForm({ discountTarget: e.target.value })}
                          fullWidth
                          size="small"
                          helperText="Les ventes ajoutées plus tard ne sont pas couvertes."
                        >
                          {DISCOUNT_TARGETS.map((target) => <MenuItem key={target.value} value={target.value}>{target.label}</MenuItem>)}
                        </TextField>
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
              {form.arrivalPayment?.collectible && !isReservationLocked && fichePristine && (
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
                  {arrivalSplitOpen && (
                    <Box sx={{ mt: 0.5, mb: 1 }}>
                      <TenderLines
                        dueCents={Math.round(Number(form.arrivalPayment.collectible.total || 0) * 100)}
                        methods={splitMethodsOf(rows)}
                        onChange={setArrivalTenders}
                        disabled={arrivalPayBusy}
                        autoFocus
                      />
                    </Box>
                  )}
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 0.5, alignItems: { sm: 'center' } }}>
                    {arrivalSplitOpen ? (
                      <Button
                        variant="contained"
                        disabled={arrivalPayBusy || !arrivalPayDate || !(arrivalTenders && arrivalTenders.canSubmit)}
                        onClick={() => runArrivalPayment('split')}
                        sx={{ textTransform: 'none', minHeight: 44, borderRadius: 999 }}
                      >
                        {TENDER_TEXTS.collect(formatCurrency(arrivalTenders && arrivalTenders.gapCents > 0
                          ? arrivalTenders.receivedCents / 100
                          : form.arrivalPayment.collectible.total))}
                      </Button>
                    ) : (
                      <>
                        <Button variant="outlined" disabled={arrivalPayBusy || !arrivalPayDate} onClick={() => runArrivalPayment('card')} sx={{ textTransform: 'none', minHeight: 44 }}>
                          CB / Chèque
                        </Button>
                        <Button variant="outlined" disabled={arrivalPayBusy || !arrivalPayDate} onClick={() => runArrivalPayment('cash')} sx={{ textTransform: 'none', minHeight: 44 }}>
                          Caisse interne
                        </Button>
                      </>
                    )}
                    <Button
                      variant="text"
                      data-split-toggle="arrival"
                      onClick={() => { setArrivalSplitOpen((v) => !v); setArrivalTenders(null); setArrivalPayError(''); }}
                      sx={{ textTransform: 'none', minHeight: 44, color: 'text.secondary', ml: { sm: 'auto !important' } }}
                    >
                      {arrivalSplitOpen ? TENDER_TEXTS.close : TENDER_TEXTS.open}
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    « Caisse interne » : encaissé hors comptabilité, comme un complément en liquide.
                  </Typography>
                </Box>
              )}

              {editingReservationId && !isDevisMode && installmentPlan && installmentPlan.eligible && (
                <Box sx={{ mb: 2 }}>
                  <InstallmentPlanCard
                    key={editingReservationId}
                    reservationId={editingReservationId}
                    plan={installmentPlan}
                    disabled={!fichePristine}
                    today={localIsoToday()}
                    onPlanChange={setInstallmentPlan}
                    onMoneyChanged={reloadReservationFinance}
                  />
                </Box>
              )}

              <LedgerList
                rows={ledgerRows}
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
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 2 }} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {(!isPlatform || Boolean(pricingQuote?.platformTakesDeposit)) && !hasInstallmentPlan && (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: { sm: 340 } }}>
                    <FormControlLabel
                      control={(
                        <Switch
                          checked={Boolean(form.depositDisabled)}
                          onChange={(e) => updateForm({
                            depositDisabled: e.target.checked,
                            // specs/disable-deposit-per-reservation.md — the server enforces the same.
                            ...(e.target.checked ? { depositPaid: false, depositPaidDate: '' } : {}),
                          })}
                          // disable-deposit-per-reservation.md rule 14 — a lock never freezes the switch ON: it may be unticked, never ticked.
                          disabled={(isReservationLocked && !editingReservationId) || (Boolean(depositDisabledLockedReason) && !form.depositDisabled)}
                          slotProps={{ input: { 'aria-describedby': depositDisabledLockReason ? 'deposit-disabled-lock-reason' : undefined } }}
                        />
                      )}
                      label={<Typography variant="body2">Sans acompte</Typography>}
                      sx={{ minHeight: 44, m: 0 }}
                    />
                    {depositDisabledLockReason && (
                      <Typography id="deposit-disabled-lock-reason" variant="caption" color="text.secondary" sx={{ mt: -0.5, mb: 1, lineHeight: 1.4 }}>
                        {depositDisabledLockReason}
                      </Typography>
                    )}
                  </Box>
                )}
                {/* Per-item routing for the tourist tax (spec force-item-to-complement.md §6.4). */}
                {Number(pricingQuote?.touristTaxTotal || 0) > 0 && !pricingQuote?.touristTaxCollectedOnArrival && (
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Tooltip title="Lorsque cette option est activée, la taxe de séjour n'est pas comprise dans l'acompte ni le solde : elle est intégralement perçue dans le Complément à percevoir (par exemple, encaissée à l'arrivée)." arrow describeChild>
                      <FormControlLabel
                        control={(
                          <Switch
                            checked={Boolean(form.touristTaxInComplement)}
                            onChange={(e) => updateForm({ touristTaxInComplement: e.target.checked })}
                            disabled={Boolean(taxInComplementLockReason)}
                            slotProps={{ input: { 'aria-describedby': taxInComplementLockReason ? 'tax-in-complement-lock-reason' : undefined } }}
                          />
                        )}
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
                    {taxInComplementLockReason && (
                      <Typography id="tax-in-complement-lock-reason" variant="caption" color="text.secondary" sx={{ mt: -0.5, mb: 1, lineHeight: 1.4 }}>
                        {taxInComplementLockReason}
                      </Typography>
                    )}
                  </Box>
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
            onSettle={({ checkedKeys, opening }, cash, split = null) => saveThenSettle(() => api.markPayment(editingReservationId, {
              settleMidStayNote: { checkedKeys, opening: opening.map(({ key, amount }) => ({ key, amount })), cash },
              // specs/mixed-method-payments.md rule 1 — the note's lines, checked against its total by the server.
              ...(split ? { expectedAmountCents: split.expectedAmountCents, tenders: split.tenders, ...(split.shortfall ? { shortfall: split.shortfall } : {}) } : {}),
            }))}
            onSellOnly={() => saveThenRun(reloadReservationFinance)}
          />
        )}
        {editingReservationId && (
          <PlatformPenaltyDialog open={penaltyOpen} onClose={() => setPenaltyOpen(false)} reservationId={editingReservationId} source="fiche" onDone={async () => { await reloadReservationFinance(); close(); }} />
        )}
        {!isDevisMode && editingReservationId && (
          <RefundDialog
            open={Boolean(refundDialogOpen)}
            onClose={() => setRefundDialogOpen(false)}
            refundableLines={refundableLines}
            collectedTtc={refundCollectedTtc}
            overpaymentTtc={refundDialogOpen && refundDialogOpen.overpaymentTtc ? refundDialogOpen.overpaymentTtc : 0}
            overpaymentLines={refundDialogOpen && refundDialogOpen.overpaymentLines ? refundDialogOpen.overpaymentLines : null}
            defaultMethod={(refundDialogOpen && refundDialogOpen.method) || 'transfer'}
            openOverpaymentTtc={openOverpaymentRow ? Number(openOverpaymentRow.amount || 0) : 0}
            onUseOverpayment={() => openOverpaymentRow && onAction(openOverpaymentRow)}
            onSubmit={createRefund}
          />
        )}
      </CardContent>
    </Card>
  );
}

// The methods the server listed on any markable row (specs/mixed-method-payments.md rule 4); TenderLines falls
// back to its own copy when none is at hand.
function splitMethodsOf(rows) {
  const row = (rows || []).find((r) => r && r.action && r.action.split && Array.isArray(r.action.split.methods));
  return row ? row.action.split.methods : null;
}
