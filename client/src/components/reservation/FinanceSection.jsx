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
import { useAppDialogs } from '../DialogProvider';
import { useReservationForm } from './ReservationFormContext';
import { formatCurrency, displayDate } from '../../utils/formatters';
import { COMPLEMENT_LABELS } from '../../constants/complements';
import { complementDeferralAccess } from '../../utils/complementDeferralAccess';

// Means of refund, French labels for the history rows (specs/reservation-refunds.md §3.1 rule 4).
const REFUND_METHOD_LABELS = {
  transfer: 'Virement',
  cash: 'Espèces',
  internal: 'Caisse interne',
};

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// « 06/08 » — the note history is dense, the year adds nothing (a stay never spans one).
function displayNoteDate(iso) {
  const full = displayDate(iso);
  return full ? full.slice(0, 5) : '';
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
 * One collectible complement: title + amount, optional itemised lines, the operator's adjusted amount,
 * « payé » / « caisse interne » toggles and the payment date. Shared by the arrival complement, the
 * end-of-stay complement and the merged « complément de fin de séjour » of a deferred reservation
 * (specs/defer-arrival-complement-to-checkout.md §3.2), so the three can never drift apart visually.
 *
 * Renders the CARD ONLY: the parent owns the grid, so two complements sit side by side on a desktop
 * (specs/adjustable-complement-amounts.md §6.5).
 *
 * Props: `title`, `amount`, `lines` ([{ label, amount }], optional), `paid`, `paidCash`, `paidDate`,
 * the three handlers `onTogglePaid(next)` / `onToggleCash(next)` / `onDateChange(v)`, the adjustment
 * (`overrideValue`, `onOverrideCommit`, `autoAmount`, `allocation`, `floor`, `adjustDisabledReason`)
 * and an optional `extra` node rendered above the actions (the « fin de séjour » switch).
 */
function ComplementCard({
  title, amount, lines = [], paid, paidCash, paidDate, onTogglePaid, onToggleCash, onDateChange,
  overrideValue, onOverrideCommit, autoAmount, allocation = null, floor = null, adjustDisabledReason = '',
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
    <Box
      sx={{
        height: '100%',
        border: paid ? 'none' : '1px solid',
        borderColor: paid ? 'transparent' : 'error.main',
        borderRadius: 1,
        p: paid ? 0 : 1.5,
      }}
    >
      {/* Red border tant qu'impayé pour signaler le reste à percevoir ; bascule en visuel
          neutre (= Acompte/Solde payé) une fois le complément encaissé. */}
      <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: lines.length ? 1 : 2 }}>
        {title}
        <Typography component="span" variant="body2" sx={{ ml: 1, color: 'text.secondary', fontWeight: 500 }}>
          ({formatCurrency(amount)})
        </Typography>
      </Typography>
      {lines.map((line, i) => (
        <Typography key={i} variant="body2" sx={{ color: 'text.secondary' }}>
          {line.label} : {formatCurrency(line.amount || 0)}
        </Typography>
      ))}
      {adjustable && (
        <Box sx={{ mt: lines.length ? 1.5 : 0 }}>
          {/* specs/adjustable-complement-amounts.md §3.1 — le montant annoncé au client l'emporte sur
              le calcul, même après encaissement. Vider le champ rend la main au moteur. */}
          <Tooltip title={adjustDisabledReason} disableHoverListener={!adjustDisabledReason}>
            <span>
              <ArithmeticTextField
                label="Montant ajusté (€)"
                value={overrideValue == null ? '' : overrideValue}
                onCommit={(v) => onOverrideCommit(v)}
                disabled={Boolean(adjustDisabledReason)}
                fullWidth
                size="small"
                helperText={helper}
              />
            </span>
          </Tooltip>
          {/* §3.6 — ce qui partira en comptabilité, poste par poste : la fiche décide, la compta
              ne recalcule rien. */}
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
      <Button
        fullWidth
        variant={paid ? 'contained' : 'outlined'}
        color={paid ? 'success' : 'inherit'}
        onClick={() => onTogglePaid(!paid)}
        sx={{ textTransform: 'none', justifyContent: 'flex-start', mt: (lines.length || adjustable || extra) ? 1.5 : 0 }}
      >
        {paid ? 'Complément payé' : 'Marquer complément payé'}
      </Button>
      {paid && (
        <DateField
          label="Payé le"
          type="date"
          value={paidDate || ''}
          onChange={(e) => onDateChange(e.target.value)}
          fullWidth
          sx={{ mt: 1.5 }}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      )}
      {/* « Caisse interne » : compté dans le suivi financier, exclu de la compta
          (specs/cash-complement-and-endofstay-finance.md §3.2). Implique « payé ». */}
      <Button
        fullWidth
        size="small"
        variant={paidCash ? 'contained' : 'outlined'}
        color={paidCash ? 'success' : 'inherit'}
        onClick={() => onToggleCash(!paidCash)}
        sx={{ textTransform: 'none', justifyContent: 'flex-start', mt: 1 }}
      >
        {paidCash ? 'Caisse interne ✓' : 'Caisse interne'}
      </Button>
      {paidCash && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Compté dans le suivi financier, hors compta.
        </Typography>
      )}
    </Box>
  );
}

/**
 * Finance card: adjusted accommodation price + "Actualiser tarifs", deposit / balance / caution with paid toggles.
 * Reads everything from the reservation form context — no props.
 */
export default function FinanceSection() {
  const {
    formSectionCardSx, formSectionContentSx, sectionGridSx,
    form, updateForm, pricingQuote, accommodationBasePriceDisplay,
    isDevisMode, reservationId, editingReservationId, isReservationLocked, refreshToCurrentPricing,
    // specs/mid-stay-notes.md — the page owns the save pipeline + the reload; the block only calls them.
    saveThenRun, reloadReservationFinance,
    // …and it owns the dialog state + the access rule, because the sticky action bar opens the same
    // dialog. Two entry points, one source of truth.
    midStayNoteOpen, setMidStayNoteOpen, midStayNote,
    // specs/reservation-refunds.md — the register is server-owned (never part of the editable form);
    // the page holds it and exposes the two mutations.
    refunds = [], refundableLines = [], refundTotals = { book: 0, withCash: 0 }, refundCollectedTtc = 0,
    refundDialogOpen, setRefundDialogOpen, createRefund, deleteRefund,
  } = useReservationForm();
  const { confirm } = useAppDialogs();
  // specs/single-payment-from-the-fiche.md §3.1 — the single arrival payment. The date is the
  // OPERATOR's (a guest who paid at the door yesterday is recorded yesterday); the server validates
  // it and its refusal is what the field shows, so both say the same thing.
  const [arrivalPayDate, setArrivalPayDate] = useState(todayStr());
  const [arrivalPayBusy, setArrivalPayBusy] = useState(false);
  const [arrivalPayError, setArrivalPayError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [refundHistoryOpen, setRefundHistoryOpen] = useState(false);

  // specs/defer-arrival-complement-to-checkout.md §3.2 — « En fin de séjour » chosen on the check-in
  // recap: there is only ONE collection left, at the door. The server ships the merged block
  // (`checkoutComplement`: total + arrival & end-of-stay lines + paid state); the fiche just renders
  // it in place of the two separate cards.
  // Le bloc fusionné vit sur le devis LIVE dès qu'il est disponible : le bloc stocké date du dernier
  // enregistrement, et une option modifiée pendant l'édition laissait la carte afficher les anciennes
  // lignes pendant que le panneau de droite suivait déjà le moteur (Adrien, 2026-08-23).
  const checkoutComplement = pricingQuote?.checkoutComplement || form.checkoutComplement || null;
  // specs/complement-buckets-by-moment.md §3 rule 4 (révisée 2026-08-22) — une seule chose fusionne
  // les cartes : le marqueur posé par l'opérateur. La fiche déduisait aussi le report du calendrier
  // (« le séjour a commencé et personne n'a encaissé »), ce qui déplaçait l'argent tout seul le jour
  // de l'arrivée, sans moyen de revenir en arrière.
  const complementDeferred = Boolean(checkoutComplement?.deferred)
    && Number(checkoutComplement?.amount || 0) > 0;

  // specs/adjustable-complement-amounts.md §3.6 — le plancher et la ventilation prête à rendre sont
  // décidés par le serveur ; la carte ne fait que les afficher.
  const complementAdjustment = form.complementAdjustment || { floor: 0, accommodation: 0, tax: 0, allocation: null };
  const arrivalAdjusted = form.complementAmountOverride !== '' && form.complementAmountOverride != null;
  const endOfStayAdjusted = form.endOfStayComplementAmountOverride !== '' && form.endOfStayComplementAmountOverride != null;
  const arrivalAutoAmount = Number(pricingQuote?.complementAmountAuto || 0);
  // Le complément de fin de séjour se lit sur le devis LIVE, pas sur le montant stocké : une
  // prestation vendue sur un complément d'arrivée déjà encaissé y part immédiatement (le moteur la
  // route, specs/mid-stay-extras-to-end-of-stay-complement.md §3.1 rule 3), et la carte doit le
  // montrer avant l'enregistrement — sinon l'opérateur voit son option disparaître de l'écran.
  const endOfStayLiveTotal = pricingQuote?.endOfStayComplementTotal;
  const endOfStayAmountNow = endOfStayLiveTotal != null
    ? Number(endOfStayLiveTotal)
    : Number(form.endOfStayComplementAmount || 0);
  // Mêmes lignes que ce que l'enregistrement écrira : celles que le SAS départ possède (et la ligne
  // d'ajustement), plus les ventes en séjour telles que le moteur vient de les recalculer.
  const storedEndOfStayLines = parseEndOfStayDetail(form.endOfStayComplementDetail);
  const endOfStayLines = pricingQuote?.midStayExtrasLines
    ? [
      ...storedEndOfStayLines.filter((l) => l && l.source !== 'midStayExtra'),
      ...pricingQuote.midStayExtrasLines,
    ]
    : storedEndOfStayLines;
  // §3.6 règle 34 — un complément fait uniquement d'hébergement n'a rien à ventiler : le réduire est
  // une remise sur le séjour, qui a son propre champ.
  const arrivalAdjustDisabledReason = (!arrivalAdjusted
    && arrivalAutoAmount > 0
    && Number(complementAdjustment.tax || 0) === 0
    && Number(complementAdjustment.floor || 0) >= arrivalAutoAmount - 0.005)
    ? 'Ce complément ne contient que de l\'hébergement. Pour le réduire, utilisez « Prix hébergement ajusté ».'
    : '';
  // §3.5 règles 29-30 — sur la carte fusionnée l'opérateur saisit le TOTAL ; l'ajustement stocké reste
  // celui du complément d'ARRIVÉE, le complément de fin de séjour gardant ses propres lignes. Le
  // décalage est un affichage, pas une règle : le serveur valide et stocke la part arrivée.
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

  // specs/defer-arrival-complement-to-checkout.md §3.3 — « Percevoir en fin de séjour » depuis la
  // fiche : même marqueur que le récap du SAS arrivée, effet immédiat, réversible, disponible à tout
  // moment. Rendu comme un bouton pleine largeur, dans la même langue visuelle que « Marquer
  // complément payé » et « Caisse interne » : en interrupteur MUI discret, l'opérateur ne le voyait
  // pas (retour d'Adrien, 2026-08-22).
  const deferAccess = complementDeferralAccess({
    editingReservationId,
    isDevisMode,
    complementAmount: Number(pricingQuote?.complementAmount || 0),
    complementPaid: Boolean(form.complementPaid) || Boolean(form.complementPaidCash),
    deferred: Boolean(form.complementDeferredToCheckout),
    locked: Boolean(isReservationLocked),
  });
  const onToggleDefer = async (next) => {
    // Reporter un complément déjà marqué encaissé le remet à percevoir : ça se confirme.
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
          fullWidth
          size="small"
          variant={deferAccess.checked ? 'contained' : 'outlined'}
          color={deferAccess.checked ? 'info' : 'inherit'}
          disabled={deferAccess.disabled}
          onClick={() => onToggleDefer(!deferAccess.checked)}
          sx={{ textTransform: 'none', justifyContent: 'flex-start', mt: 1 }}
        >
          {deferAccess.checked ? 'Perçu en fin de séjour ✓' : 'Percevoir en fin de séjour'}
        </Button>
      </span>
    </Tooltip>
  ) : null;

  // specs/platform-payment-entry.md — on a platform reservation the brut is the single price lever, so
  // « Prix hébergement ajusté » / « Réduction » are hidden (they'd conflict with the brut pin).
  const isPlatform = String(form.platform || 'direct').toLowerCase() !== 'direct';
  // specs/platform-deposit-toggle.md — a platform configured « Acompte = Oui » takes a normal
  // acompte/solde split, so the fiche shows the acompte block instead of the « pas d'acompte » message.
  // The flag is echoed by the engine in the live quote (true only for non-direct platforms).
  const platformTakesDeposit = Boolean(pricingQuote?.platformTakesDeposit);
  const showNoDepositMessage = isPlatform && !platformTakesDeposit;

  // specs/mid-stay-notes.md §3.5 — « Complément durant le séjour ». La règle d'affichage vient du même
  // `midStayNoteAccess` que le bouton de la barre d'actions (utils/midStayNoteAccess.js) : les deux
  // surfaces ne peuvent pas diverger.
  const midStayNotes = parseEndOfStayDetail(form.midStaySettledNotes);

  // One click, one payment: settle every collectible arrival bucket (or undo the group), then reload
  // the finance block from the server — the amounts, the group and the bucket flags are all its call.
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

  // specs/arrival-payment-detail-and-adjustment.md §3.2 — what the guest ACTUALLY handed over. The
  // réduction (or the pourboire) is derived and clamped server-side; the field only carries the
  // operator's amount, and '' restores the computed total.
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
  const midStayNotesTotal = midStayNotes.reduce((s, n) => s + (Number(n.total) || 0), 0);
  const endOfStaySettled = Boolean(form.endOfStayComplementPaid) || Boolean(form.endOfStayComplementPaidCash);
  const showMidStayNotes = Boolean(midStayNote?.visible);
  // Mid-stay lines still to collect: what a new note can settle (the SAS-billed lines of the
  // end-of-stay complement are collected at the door, never on a note).
  const pendingMidStayLines = parseEndOfStayDetail(form.endOfStayComplementDetail)
    .filter((l) => l && l.source === 'midStayExtra' && Number(l.amount) > 0);

  const onDeleteRefund = async (refund) => {
    const ok = await confirm({
      title: 'Supprimer ce remboursement ?',
      message: 'L\'écriture d\'avoir correspondante disparaîtra de l\'export comptable.',
      confirmColor: 'error',
    });
    if (!ok) return;
    await deleteRefund(refund.id);
  };

  // §3.1 règle 9 — une carte dont le montant tombe à 0 À CAUSE d'un ajustement reste affichée : sinon
  // l'opérateur n'aurait plus aucun moyen d'effacer l'ajustement. À 0 sans ajustement, elle disparaît.
  const showArrivalComplement = !complementDeferred
    && (Number(pricingQuote?.complementAmount || 0) > 0 || arrivalAdjusted);
  const showEndOfStayComplement = !complementDeferred
    && (endOfStayAmountNow > 0 || endOfStayAdjusted);

  // §3.4 — modifier une note en place. L'erreur serveur (montant supérieur au reste à percevoir,
  // complément déjà encaissé) remonte à la ligne, qui l'affiche sans se refermer.
  const onAdjustNote = async (note, patch) => {
    await api.markPayment(editingReservationId, { adjustMidStayNote: { id: note.id, ...patch } });
    await reloadReservationFinance();
  };

  // §3.4 — reporter une note au départ. Mécaniquement c'est l'annulation de l'encaissement : les
  // prestations de la note repartent dans ce qui reste à percevoir à la porte, et la note quitte le
  // registre. Le libellé dit l'intention (regrouper la collecte) plutôt que le mécanisme.
  const onCancelNote = async (note) => {
    const ok = await confirm({
      title: 'Reporter cette note au départ ?',
      message: 'Ses prestations rejoignent le complément de fin de séjour, à encaisser en une seule fois. La note disparaît du registre.',
    });
    if (!ok) return;
    await api.markPayment(editingReservationId, { cancelMidStayNote: { id: note.id } });
    await reloadReservationFinance();
  };

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
                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
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
                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
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
                      {/* Accepts arithmetic: typing e.g. "100+20" commits 120 on Enter/blur
                          (specs/reservation-price-arithmetic.md). */}
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
                          slotProps={{
                            htmlInput: { min: 0, max: 100 }
                          }}
                        />
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
                )}
              </Grid>
            </Box>

            {String(form.platform || 'direct').toLowerCase() !== 'direct' && (() => {
              // specs/platform-payment-entry.md + platform-per-echeance-commission.md — the brut pins the
              // total séjour; the commissions are now entered per échéance (acompte + solde blocks). The
              // « Net perçu » here = total − the engine's total commission; the virement reconciles it.
              const totalSejour = Number(pricingQuote?.totalStayPrice ?? pricingQuote?.finalPrice ?? 0);
              const commission = Number(pricingQuote?.totalPlatformCommission
                ?? ((Number(form.platformCommissionAmount || 0)) + (Number(form.acompteCommissionAmount || 0))));
              // The platform only settles the PRE-ARRIVAL amount: the complement (the on-arrival tourist
              // tax for owner-collect platforms + on-site extras) is collected by us at check-in, never by
              // the platform. Exclude it so the reconciliation no longer shows an écart equal to the tax
              // (specs/platform-payment-entry.md). The server-provided `platformNetReceivedAmount` already
              // accounts for this; this fallback (no commission entered) must mirror it.
              const preArrival = Math.round((totalSejour - Number(pricingQuote?.complementAmount || 0)) * 100) / 100;
              const netPercu = pricingQuote?.platformNetReceivedAmount != null
                ? Number(pricingQuote.platformNetReceivedAmount)
                : Math.round((preArrival - commission) * 100) / 100;
              const virement = form.platformPayoutAmount === '' || form.platformPayoutAmount == null
                ? null : Number(form.platformPayoutAmount);
              const ecart = virement == null ? null : Math.round((netPercu - virement) * 100) / 100;
              const reconcileOk = ecart != null && Math.abs(ecart) < 0.01;
              // « Calculer » (specs/platform-payment-calculer-button.md): one-shot, on-demand fill of
              // the SOLDE commission from the entered amounts — commission = montant client − virement,
              // minus an already-entered acompte commission (so the books reconcile: net perçu = virement).
              // Nothing is automatic; the computed value stays freely editable. Enabled only once both the
              // montant client (brut) and the virement reçu are filled.
              // No tourist tax is ever subtracted here (specs/platform-brut-excludes-offered-tourist-tax.md):
              // whatever the platform's tax mode, the amount typed above and the virement are on the same
              // footing — either both carry the tax (the platform reverses it to us) or neither does (the
              // platform collects and remits it itself). Deducting our OWN tax estimate under-stated the
              // commission by that estimate, which is never the platform's figure anyway (Booking bills
              // 4,4 % of the stay where we compute a per-person nightly rate).
              const platformGrossFilled = form.platformGrossAmount !== '' && form.platformGrossAmount != null;
              const platformPayoutFilled = form.platformPayoutAmount !== '' && form.platformPayoutAmount != null;
              const canComputeCommission = platformGrossFilled && platformPayoutFilled && !isReservationLocked;
              const computeCommissionFromPayout = () => {
                const grossNum = Number(form.platformGrossAmount);
                const payoutNum = Number(form.platformPayoutAmount);
                if (!Number.isFinite(grossNum) || !Number.isFinite(payoutNum)) return;
                const acompteComm = Number(form.acompteCommissionAmount) || 0;
                const soldeComm = Math.max(0, Math.round((grossNum - payoutNum - acompteComm) * 100) / 100);
                updateForm({ platformCommissionAmount: soldeComm });
              };
              // Which number to copy off the platform's statement depends on its tourist-tax mode, so the
              // field says it (specs/platform-brut-excludes-offered-tourist-tax.md §6). Getting this wrong
              // is what under-stated the commission on every Gîtes de France booking.
              const taxOfferedByPlatform = Boolean(pricingQuote?.touristTaxOfferedByPlatform);
              const taxReversedByPlatform = Boolean(pricingQuote?.touristTaxReversedByPlatform);
              const grossLabel = taxOfferedByPlatform
                ? 'Total séjour facturé par la plateforme'
                : 'Montant total payé par le client';
              const grossHelper = taxOfferedByPlatform
                ? "Hébergement + options, hors taxe de séjour et hors frais de dossier — l'hébergement s'ajuste automatiquement."
                : taxReversedByPlatform
                  ? 'Taxe de séjour comprise — la plateforme vous la reverse avec le virement.'
                  : "L'hébergement s'ajuste automatiquement (brut − options). La taxe de séjour est encaissée à l'arrivée.";
              return (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 1.5 }}>Paiement plateforme</Typography>
                    <Grid container spacing={2} sx={{ ...sectionGridSx, alignItems: 'flex-start' }}>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <ArithmeticTextField
                          label={grossLabel}
                          value={form.platformGrossAmount ?? ''}
                          onCommit={(v) => updateForm({ platformGrossAmount: v })}
                          fullWidth
                          size="small"
                          helperText={grossHelper}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <ArithmeticTextField
                          label="Virement reçu (contrôle)"
                          value={form.platformPayoutAmount ?? ''}
                          onCommit={(v) => updateForm({ platformPayoutAmount: v })}
                          fullWidth
                          size="small"
                          helperText="Le montant réellement viré (facultatif) — pour vérifier la cohérence."
                        />
                      </Grid>
                    </Grid>
                    <Stack direction="row" spacing={1.5} sx={{ mt: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Tooltip title={canComputeCommission ? 'Commission solde = total facturé − virement (− commission acompte éventuelle)' : 'Renseignez le total facturé et le virement reçu'}>
                        <span>
                          <Button size="small" variant="outlined" onClick={computeCommissionFromPayout} disabled={!canComputeCommission}>
                            Calculer la commission
                          </Button>
                        </span>
                      </Tooltip>
                      <Typography variant="body2">
                        Net perçu : <strong>{formatCurrency(netPercu)}</strong>
                      </Typography>
                      {virement != null && (
                        <StatusBadge
                          status={reconcileOk ? 'success' : 'warning'}
                          label={reconcileOk ? '✓ cohérent avec le virement' : `écart : ${formatCurrency(ecart)}`}
                        />
                      )}
                    </Stack>
                  </Box>
                </>
              );
            })()}

            <Divider />

            {/* specs/single-payment-at-check-in.md §3.4 rule 16 — the guest handed over ONE payment
                at the door. The buckets below keep their own amounts and their own controls; this
                line is what says they were collected together, once. It disappears the moment one of
                them is un-ticked (rule 17), because the payment is then no longer true. */}
            {form.arrivalPayment?.covers && (
              <ArrivalPaymentCard
                payment={form.arrivalPayment}
                busy={arrivalPayBusy}
                error={arrivalPayError}
                readOnly={isReservationLocked}
                onCommitTotal={commitArrivalTotal}
                onUndo={() => runArrivalPayment('undo')}
              />
            )}

            {/* specs/single-payment-from-the-fiche.md §3.1 — the stay and the complement are both
                still to be collected: offer to record them as the ONE payment the guest actually
                made. Nothing else is touched — no SAS page runs, so the planning « préparé » flags
                and everything the check-in recorded stay exactly as they are. */}
            {form.arrivalPayment?.collectible && (
              <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
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
                  <Button
                    variant="outlined"
                    disabled={arrivalPayBusy || !arrivalPayDate}
                    onClick={() => runArrivalPayment('card')}
                    sx={{ textTransform: 'none', minHeight: 44 }}
                  >
                    CB / Chèque
                  </Button>
                  <Button
                    variant="outlined"
                    disabled={arrivalPayBusy || !arrivalPayDate}
                    onClick={() => runArrivalPayment('cash')}
                    sx={{ textTransform: 'none', minHeight: 44 }}
                  >
                    Caisse interne
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  « Caisse interne » : encaissé hors comptabilité, comme un complément en liquide.
                </Typography>
              </Box>
            )}

            <Box>
              <Grid container spacing={2} sx={sectionGridSx}>
                {/* accounting-platform-commission-and-no-deposit.md §3.3 rule 5 + §3.8 rule 21.
                    A platform configured « sans acompte » (default) is paid in a single transfer — the
                    whole pre-arrival amount lands on the Solde. A platform set « Acompte = Oui »
                    (specs/platform-deposit-toggle.md) shows the normal acompte block below. */}
                {showNoDepositMessage ? (
                  <Grid
                    size={{ xs: 12, md: 6 }}>
                    <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 1 }}>Acompte</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                      Pas d'acompte (réservation plateforme — virement unique). Le montant total est
                      encaissé en une fois via le Solde.
                    </Typography>
                  </Grid>
                ) : (
                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 2 }}>
                    <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 0 }}>Acompte</Typography>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={Boolean(form.depositDisabled)}
                          onChange={(e) => updateForm({
                            depositDisabled: e.target.checked,
                            // When the operator disables the deposit, also clear the paid flags
                            // so the next save doesn't persist an inconsistent (disabled + paid)
                            // state. The server enforces the same on its side; the client mirror
                            // keeps the UI consistent immediately. See
                            // specs/disable-deposit-per-reservation.md.
                            ...(e.target.checked ? { depositPaid: false, depositPaidDate: '' } : {}),
                          })}
                          disabled={isReservationLocked && !editingReservationId}
                        />
                      }
                      label={<Typography variant="caption" color="text.secondary">Désactiver</Typography>}
                      labelPlacement="start"
                      sx={{ mr: 0, ml: 0 }}
                    />
                  </Box>

                  {form.depositDisabled ? (
                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mt: 1 }}>
                      Acompte désactivé — ajouté au solde.
                    </Typography>
                  ) : (
                    <>
                      {/* Manual deposit override (specs/editable-deposit-amount.md). Empty = auto
                          (percentage). A value freezes the acompte; the solde absorbs tariff changes.
                          Hidden in devis mode (out of scope) and locked once the acompte is paid.
                          Accepts arithmetic like "Prix ajusté" (commit on Enter/blur). */}
                      {!isDevisMode && (
                        <ArithmeticTextField
                          label="Montant acompte (€)"
                          value={form.depositAmountOverride}
                          onCommit={(v) => updateForm({ depositAmountOverride: v })}
                          fullWidth
                          size="small"
                          disabled={isReservationLocked || Boolean(form.depositPaid)}
                          sx={{ mb: 1.5 }}
                          helperText={
                            form.depositPaid
                              ? 'Acompte payé, montant figé.'
                              : form.depositAmountOverride !== ''
                                ? 'Acompte figé — le solde absorbe les variations de tarif.'
                                : `Calcul automatique${pricingQuote?.property?.depositPercent != null ? ` (${pricingQuote.property.depositPercent}%)` : ''}. Saisir un montant pour le figer.`
                          }
                        />
                      )}
                      {/* specs/platform-per-echeance-commission.md — commission on the acompte (platform
                          only), booked on the platform's account on the deposit entry. */}
                      {isPlatform && (
                        <ArithmeticTextField
                          label="Commission acompte (€)"
                          value={form.acompteCommissionAmount ?? ''}
                          onCommit={(v) => updateForm({ acompteCommissionAmount: v })}
                          fullWidth
                          size="small"
                          disabled={isReservationLocked}
                          sx={{ mb: 1.5 }}
                          helperText="Frais retenus sur l'acompte (compta : compte de la plateforme)."
                        />
                      )}
                      <DateField
                        label="Échéance acompte"
                        type="date"
                        value={form.depositDueDate}
                        disabled={isReservationLocked}
                        onChange={(e) => updateForm({ depositDueDate: e.target.value })}
                        fullWidth
                        slotProps={{
                          inputLabel: { shrink: true }
                        }}
                      />
                      <Button
                        fullWidth
                        variant={form.depositPaid ? 'contained' : 'outlined'}
                        color={form.depositPaid ? 'success' : 'inherit'}
                        onClick={async () => {
                          const next = !form.depositPaid;
                          const today = todayStr();
                          const date = next ? (form.depositPaidDate || today) : '';
                          // specs/single-payment-from-the-fiche.md rule 11bis — l'état payé appartient
                          // au serveur : on l'écrit TOUT DE SUITE, comme le complément le fait déjà, au
                          // lieu de le confier au prochain Enregistrer. C'est ce qui permet à
                          // l'enregistrement d'ignorer ces drapeaux, et donc de ne plus pouvoir en
                          // effacer un par mégarde.
                          if (editingReservationId) {
                            await api.markPayment(editingReservationId, { depositPaid: next, depositPaidDate: date || null });
                          }
                          updateForm({ depositPaid: next, depositPaidDate: date });
                          // …et le bloc du paiement unique reflète le serveur : le groupe a pu mourir ici.
                          if (editingReservationId) await reloadReservationFinance();
                        }}
                        sx={{ mt: 1.5, textTransform: 'none', justifyContent: 'flex-start' }}
                      >
                        {form.depositPaid ? 'Acompte payé' : 'Marquer acompte payé'}
                      </Button>
                      {/* specs/collect-stay-payment-at-check-in.md §3.4 rule 20 — read-only: the SAS
                          collected it at the door, hors compta. Un-ticking the bucket clears it. */}
                      {form.depositPaid && form.depositPaidCash && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          Caisse interne ✓ — encaissé à l'arrivée, hors compta.
                        </Typography>
                      )}
                      {form.depositPaid && (
                        <DateField
                          label="Payé le"
                          type="date"
                          value={form.depositPaidDate || ''}
                          onChange={async (e) => {
                            const v = e.target.value;
                            updateForm({ depositPaidDate: v });
                            if (editingReservationId) {
                              await api.markPayment(editingReservationId, { depositPaid: true, depositPaidDate: v || null });
                            }
                          }}
                          fullWidth
                          sx={{ mt: 1.5 }}
                          slotProps={{
                            inputLabel: { shrink: true }
                          }}
                        />
                      )}
                    </>
                  )}
                </Grid>
                )}

                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
                  <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 2 }}>Solde</Typography>
                  {/* specs/platform-per-echeance-commission.md — commission on the solde (platform only),
                      booked on the platform's account on the balance entry. */}
                  {isPlatform && (
                    <ArithmeticTextField
                      label="Commission solde (€)"
                      value={form.platformCommissionAmount ?? ''}
                      onCommit={(v) => updateForm({ platformCommissionAmount: v })}
                      fullWidth
                      size="small"
                      disabled={isReservationLocked}
                      sx={{ mb: 1.5 }}
                      helperText="Frais retenus sur le solde (compta : compte de la plateforme)."
                    />
                  )}
                  <DateField
                    label="Échéance solde"
                    type="date"
                    value={form.balanceDueDate}
                    disabled={isReservationLocked}
                    onChange={(e) => updateForm({ balanceDueDate: e.target.value })}
                    fullWidth
                    slotProps={{
                      inputLabel: { shrink: true }
                    }}
                  />
                  <Button
                    fullWidth
                    variant={form.balancePaid ? 'contained' : 'outlined'}
                    color={form.balancePaid ? 'success' : 'inherit'}
                    onClick={async () => {
                      const next = !form.balancePaid;
                      const today = todayStr();
                      const date = next ? (form.balancePaidDate || today) : '';
                      // rule 11bis — même règle que l'acompte : écriture immédiate, serveur maître.
                      if (editingReservationId) {
                        await api.markPayment(editingReservationId, { balancePaid: next, balancePaidDate: date || null });
                      }
                      updateForm({ balancePaid: next, balancePaidDate: date });
                      if (editingReservationId) await reloadReservationFinance();
                    }}
                    sx={{ mt: 1.5, textTransform: 'none', justifyContent: 'flex-start' }}
                  >
                    {form.balancePaid ? 'Solde payé' : 'Marquer solde payé'}
                  </Button>
                  {form.balancePaid && form.balancePaidCash && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Caisse interne ✓ — encaissé à l'arrivée, hors compta.
                    </Typography>
                  )}
                  {form.balancePaid && (
                    <DateField
                      label="Payé le"
                      type="date"
                      value={form.balancePaidDate || ''}
                      onChange={async (e) => {
                        const v = e.target.value;
                        updateForm({ balancePaidDate: v });
                        if (editingReservationId) {
                          await api.markPayment(editingReservationId, { balancePaid: true, balancePaidDate: v || null });
                        }
                      }}
                      fullWidth
                      sx={{ mt: 1.5 }}
                      slotProps={{
                        inputLabel: { shrink: true }
                      }}
                    />
                  )}
                </Grid>
              </Grid>
            </Box>

            {/* Per-item routing for the tourist tax (spec force-item-to-complement.md §6.4).
                When ON, the tax bypasses the auto deposit/balance split and lives 100 % in the
                Complément entry. Hidden when:
                  - no tax to route (touristTaxTotal === 0), OR
                  - the engine already routes the tax to Complément on its own — i.e. the
                    booking is on a non-direct platform configured to NOT collect the tax
                    (`touristTaxCollectedOnArrival = true`). In that case the toggle is moot:
                    the tax always lands in Complément, the user can't change it, showing the
                    Switch would only be confusing. */}
            {Number(pricingQuote?.touristTaxTotal || 0) > 0
              && !Boolean(pricingQuote?.touristTaxCollectedOnArrival) && (
              <>
                <Divider />
                <Box>
                  <Tooltip title="Lorsque cette option est activée, la taxe de séjour n'est pas comprise dans l'acompte ni le solde : elle est intégralement perçue dans le Complément à percevoir (par exemple, encaissée à l'arrivée)." arrow>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={Boolean(form.touristTaxInComplement)}
                          onChange={(e) => updateForm({ touristTaxInComplement: e.target.checked })}
                        />
                      }
                      label={
                        <Typography variant="body2">
                          Taxe de séjour en complément
                          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                            ({formatCurrency(pricingQuote.touristTaxTotal)})
                          </Typography>
                        </Typography>
                      }
                    />
                  </Tooltip>
                </Box>
              </>
            )}

            {/* Les compléments, dans une seule grille : deux cartes par ligne sur ordinateur, empilées
                sur mobile (specs/adjustable-complement-amounts.md §6.5). Arrivée et fin de séjour
                d'abord, côte à côte — ce sont les deux qu'on compare, et le report bascule de l'une à
                l'autre. « Durant le séjour », qui est un registre et pas une collecte à venir, suit. */}
            {(complementDeferred || showArrivalComplement || showMidStayNotes || showEndOfStayComplement) && (
              <>
                <Divider />
                <Box>
                  <Grid container spacing={2} sx={{ ...sectionGridSx, alignItems: 'stretch' }}>
                    {/* Deferred to check-out (specs/defer-arrival-complement-to-checkout.md §3.2 rules 6-8):
                        ONE card for ONE collection — the arrival lines and the end-of-stay lines together,
                        one total, one « payé » action (the server settles both buckets). */}
                    {complementDeferred && (
                      <Grid size={{ xs: 12, md: 6 }}>
                        <ComplementCard
                          title={COMPLEMENT_LABELS.endOfStay}
                          amount={checkoutComplement.amount}
                          lines={checkoutComplement.lines || []}
                          paid={form.complementPaid}
                          paidCash={form.complementPaidCash}
                          paidDate={form.complementPaidDate}
                          extra={deferButton}
                          overrideValue={mergedOverrideValue}
                          onOverrideCommit={commitArrivalOverride}
                          autoAmount={mergedAutoAmount}
                          allocation={complementAdjustment.allocation}
                          floor={mergedFloor}
                          adjustDisabledReason={arrivalAdjustDisabledReason}
                          onTogglePaid={async (next) => {
                            const date = next ? (form.complementPaidDate || todayStr()) : '';
                            if (editingReservationId) {
                              await api.markPayment(editingReservationId, { complementPaid: next, complementPaidDate: date || null });
                            }
                            updateForm({
                              complementPaid: next, complementPaidDate: date,
                              endOfStayComplementPaid: next, endOfStayComplementPaidDate: date,
                              ...(next ? {} : { complementPaidCash: false, endOfStayComplementPaidCash: false }),
                            });
                          }}
                          onDateChange={async (v) => {
                            updateForm({ complementPaidDate: v, endOfStayComplementPaidDate: v });
                            if (editingReservationId) {
                              await api.markPayment(editingReservationId, { complementPaid: true, complementPaidDate: v || null });
                            }
                          }}
                          onToggleCash={async (next) => {
                            const date = form.complementPaidDate || todayStr();
                            if (editingReservationId) {
                              await api.markPayment(editingReservationId, { complementPaidCash: next });
                            }
                            updateForm(next
                              ? {
                                complementPaidCash: true, complementPaid: true, complementPaidDate: date,
                                endOfStayComplementPaidCash: true, endOfStayComplementPaid: true, endOfStayComplementPaidDate: date,
                              }
                              : { complementPaidCash: false, endOfStayComplementPaidCash: false });
                          }}
                        />
                      </Grid>
                    )}

                    {showArrivalComplement && (
                      <Grid size={{ xs: 12, md: 6 }}>
                        <ComplementCard
                          title={COMPLEMENT_LABELS.arrival}
                          amount={pricingQuote?.complementAmount || 0}
                          paid={form.complementPaid}
                          paidCash={form.complementPaidCash}
                          paidDate={form.complementPaidDate}
                          extra={deferButton}
                          overrideValue={form.complementAmountOverride}
                          onOverrideCommit={commitArrivalOverride}
                          autoAmount={arrivalAutoAmount}
                          allocation={complementAdjustment.allocation}
                          floor={complementAdjustment.floor}
                          adjustDisabledReason={arrivalAdjustDisabledReason}
                          // L'encaissement est un acte, pas un brouillon : il part tout de suite, comme
                          // « Caisse interne » et comme le bouton de la carte de fin de séjour. Il
                          // n'écrivait qu'en base sur une réservation VERROUILLÉE et attendait un
                          // « Enregistrer » sinon — le formulaire disait « non encaissé » pendant que le
                          // serveur disait l'inverse, et c'est le serveur qui décide de la fusion des
                          // cartes : dé-marquer puis reporter ne fusionnait rien (Adrien, 2026-08-22).
                          onTogglePaid={async (next) => {
                            const date = next ? (form.complementPaidDate || todayStr()) : '';
                            if (editingReservationId) {
                              await api.markPayment(editingReservationId, { complementPaid: next, complementPaidDate: date || null });
                            }
                            updateForm({ complementPaid: next, complementPaidDate: date });
                            if (editingReservationId) await reloadReservationFinance();
                          }}
                          onDateChange={async (v) => {
                            updateForm({ complementPaidDate: v });
                            if (editingReservationId) {
                              await api.markPayment(editingReservationId, { complementPaid: true, complementPaidDate: v || null });
                            }
                          }}
                          onToggleCash={async (next) => {
                            const date = form.complementPaidDate || todayStr();
                            if (editingReservationId) {
                              await api.markPayment(editingReservationId, { complementPaidCash: next });
                            }
                            updateForm(next
                              ? { complementPaidCash: true, complementPaid: true, complementPaidDate: date }
                              : { complementPaidCash: false });
                          }}
                        />
                      </Grid>
                    )}

                    {showEndOfStayComplement && (
                      <Grid size={{ xs: 12, md: 6 }}>
                        <ComplementCard
                          title={COMPLEMENT_LABELS.endOfStay}
                          amount={endOfStayAmountNow}
                          lines={endOfStayLines}
                          paid={form.endOfStayComplementPaid}
                          paidCash={form.endOfStayComplementPaidCash}
                          paidDate={form.endOfStayComplementPaidDate}
                          overrideValue={form.endOfStayComplementAmountOverride}
                          onOverrideCommit={(v) => updateForm({ endOfStayComplementAmountOverride: v })}
                          autoAmount={pricingQuote?.endOfStayComplementAutoTotal != null
                            ? pricingQuote.endOfStayComplementAutoTotal
                            : form.endOfStayComplementAmountAuto}
                          onTogglePaid={async (next) => {
                            const date = next ? (form.endOfStayComplementPaidDate || todayStr()) : '';
                            if (editingReservationId) {
                              await api.markPayment(editingReservationId, { endOfStayComplementPaid: next, endOfStayComplementPaidDate: date || null });
                            }
                            updateForm({ endOfStayComplementPaid: next, endOfStayComplementPaidDate: date, ...(next ? {} : { endOfStayComplementPaidCash: false }) });
                          }}
                          onDateChange={async (v) => {
                            updateForm({ endOfStayComplementPaidDate: v });
                            if (editingReservationId) {
                              await api.markPayment(editingReservationId, { endOfStayComplementPaid: true, endOfStayComplementPaidDate: v || null });
                            }
                          }}
                          onToggleCash={async (next) => {
                            const date = form.endOfStayComplementPaidDate || todayStr();
                            if (editingReservationId) {
                              await api.markPayment(editingReservationId, { endOfStayComplementPaidCash: next });
                            }
                            updateForm(next
                              ? { endOfStayComplementPaidCash: true, endOfStayComplementPaid: true, endOfStayComplementPaidDate: date }
                              : { endOfStayComplementPaidCash: false });
                          }}
                        />
                      </Grid>
                    )}
                    {/* Complément durant le séjour (specs/mid-stay-notes.md §3.5 rule 17): running total of the
                        settled notes + the « Nouvelle note » entry point + a browsable history. Placed
                        between the two complements, in collection order. */}
                    {showMidStayNotes && (
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 1 }}>
                          {COMPLEMENT_LABELS.duringStay}
                          {midStayNotesTotal > 0 && (
                            <Typography component="span" variant="body2" sx={{ ml: 1, color: 'text.secondary', fontWeight: 500 }}>
                              ({formatCurrency(midStayNotesTotal)})
                            </Typography>
                          )}
                        </Typography>
                        <Tooltip title={midStayNote?.reason || ''}>
                          <span>
                            <Button
                              fullWidth
                              variant="outlined"
                              disabled={Boolean(midStayNote?.disabled)}
                              onClick={() => setMidStayNoteOpen(true)}
                              sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
                            >
                              + Nouvelle note
                            </Button>
                          </span>
                        </Tooltip>
                        {midStayNotes.length > 0 && (
                          <>
                            <Button
                              size="small"
                              onClick={() => setHistoryOpen((v) => !v)}
                              sx={{ textTransform: 'none', mt: 1 }}
                            >
                              {historyOpen ? 'Masquer l\'historique' : `Voir l'historique (${midStayNotes.length} note${midStayNotes.length > 1 ? 's' : ''})`}
                            </Button>
                            {historyOpen && midStayNotes.map((note) => (
                              <MidStayNoteRow
                                key={note.id}
                                note={note}
                                settled={endOfStaySettled}
                                onCancel={() => onCancelNote(note)}
                                onAdjust={(patch) => onAdjustNote(note, patch)}
                              />
                            ))}
                          </>
                        )}
                      </Grid>
                    )}

                  </Grid>
                </Box>
                {showMidStayNotes && (
                  <MidStayNoteDialog
                    open={Boolean(midStayNoteOpen)}
                    onClose={() => setMidStayNoteOpen(false)}
                    pendingLines={pendingMidStayLines}
                    // A catalogue addition is a normal sale: it rides the STANDARD save pipeline, then
                    // the note is settled against the freshly stored remainder.
                    onSettle={(items, cash) => saveThenRun(async () => {
                      await api.markPayment(editingReservationId, {
                        settleMidStayNote: { items: items.map(({ key, amount }) => ({ key, amount })), cash },
                      });
                      await reloadReservationFinance();
                    })}
                    onSellOnly={() => saveThenRun(reloadReservationFinance)}
                  />
                )}
              </>
            )}

            {/* Remboursements (specs/reservation-refunds.md §6): what was given back to the guest
                AFTER the sale. Placed after the collection blocks — the money flows out once
                everything above has flowed in. Hidden entirely on a devis. */}
            {!isDevisMode && editingReservationId && (
              <>
                <Divider />
                <Box>
                  <Grid container spacing={2} sx={sectionGridSx}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 1 }}>
                        Remboursements
                        {refundTotals.withCash > 0 && (
                          <Typography component="span" variant="body2" sx={{ ml: 1, color: 'text.secondary', fontWeight: 500 }}>
                            (− {formatCurrency(refundTotals.withCash)})
                          </Typography>
                        )}
                      </Typography>
                      <Button
                        fullWidth
                        variant="outlined"
                        onClick={() => setRefundDialogOpen(true)}
                        sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
                      >
                        + Nouveau remboursement
                      </Button>
                      {refunds.length > 0 && (
                        <>
                          <Button
                            size="small"
                            onClick={() => setRefundHistoryOpen((v) => !v)}
                            sx={{ textTransform: 'none', mt: 1 }}
                          >
                            {refundHistoryOpen
                              ? 'Masquer l\'historique'
                              : `Voir l'historique (${refunds.length} remboursement${refunds.length > 1 ? 's' : ''})`}
                          </Button>
                          {refundHistoryOpen && refunds.map((refund) => (
                            <Box key={refund.id} sx={{ mt: 1, pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {displayDate(refund.refundDate)} — {formatCurrency(refund.totalTtc)} — {REFUND_METHOD_LABELS[refund.method] || refund.method}
                                </Typography>
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() => onDeleteRefund(refund)}
                                  sx={{ textTransform: 'none', minWidth: 44, minHeight: 44 }}
                                  aria-label="Supprimer ce remboursement"
                                >
                                  ✕
                                </Button>
                              </Box>
                              {(refund.lines || []).map((line) => (
                                <Typography key={line.id} variant="body2" sx={{ color: 'text.secondary' }}>
                                  {line.label} : − {formatCurrency(line.amountTtc)}
                                </Typography>
                              ))}
                              {refund.reason && (
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                                  « {refund.reason} »
                                </Typography>
                              )}
                            </Box>
                          ))}
                        </>
                      )}
                    </Grid>
                  </Grid>
                </Box>
                <RefundDialog
                  open={Boolean(refundDialogOpen)}
                  onClose={() => setRefundDialogOpen(false)}
                  refundableLines={refundableLines}
                  collectedTtc={refundCollectedTtc}
                  onSubmit={createRefund}
                />
              </>
            )}

            <Divider />

            <Box>
              <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 1.5 }}>Caution</Typography>
              <Grid container spacing={1.5} sx={sectionGridSx}>
                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
                  <Button
                    fullWidth
                    variant={form.cautionReceived ? 'contained' : 'outlined'}
                    color={form.cautionReceived ? 'info' : 'inherit'}
                    onClick={async () => {
                      const next = !form.cautionReceived;
                      const today = todayStr();
                      if (isReservationLocked && editingReservationId) {
                        const date = next ? today : '';
                        await api.markPayment(editingReservationId, { cautionReceived: next, cautionReceivedDate: date });
                        updateForm({ cautionReceived: next, cautionReceivedDate: date });
                      } else {
                        updateForm({ cautionReceived: next, cautionReceivedDate: next ? today : '' });
                      }
                    }}
                    sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
                  >
                    {form.cautionReceived ? 'Caution reçue' : 'Marquer caution reçue'}
                  </Button>
                  <DateField
                    label="Date réception"
                    type="date"
                    value={form.cautionReceivedDate}
                    onChange={(e) => {
                      const selectedDate = e.target.value;
                      updateForm({
                        cautionReceivedDate: selectedDate,
                        cautionReceived: selectedDate ? true : form.cautionReceived,
                      });
                    }}
                    fullWidth
                    sx={{ mt: 2 }}
                    slotProps={{
                      inputLabel: { shrink: true }
                    }}
                  />
                </Grid>
                <Grid
                  size={{
                    xs: 12,
                    md: 6
                  }}>
                  <Button
                    fullWidth
                    variant={form.cautionReturned ? 'contained' : 'outlined'}
                    color={form.cautionReturned ? 'secondary' : 'inherit'}
                    onClick={async () => {
                      const next = !form.cautionReturned;
                      const today = todayStr();
                      if (isReservationLocked && editingReservationId) {
                        const date = next ? today : form.cautionReturnedDate;
                        await api.markPayment(editingReservationId, { cautionReturned: next, cautionReturnedDate: date });
                        updateForm({ cautionReturned: next, cautionReturnedDate: date });
                      } else {
                        updateForm({ cautionReturned: next, cautionReturnedDate: next ? today : form.cautionReturnedDate });
                      }
                    }}
                    sx={{ textTransform: 'none', justifyContent: 'flex-start' }}
                  >
                    {form.cautionReturned ? 'Caution restituée' : 'Marquer caution restituée'}
                  </Button>
                  <DateField
                    label="Date restitution"
                    type="date"
                    value={form.cautionReturnedDate}
                    onChange={(e) => updateForm({ cautionReturnedDate: e.target.value })}
                    fullWidth
                    sx={{ mt: 2 }}
                    slotProps={{
                      inputLabel: { shrink: true }
                    }}
                  />
                </Grid>
              </Grid>
            </Box>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}
