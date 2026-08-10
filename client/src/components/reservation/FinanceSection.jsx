import React, { useState } from 'react';
import { Box, Card, CardContent, Typography, Stack, Divider, Grid, TextField, Button, Switch, FormControlLabel, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import api from '../../api';
import ArithmeticTextField from '../ArithmeticTextField';
import DateField from '../DateField';
import StatusBadge from '../StatusBadge';
import MidStayNoteDialog from './MidStayNoteDialog';
import RefundDialog from './RefundDialog';
import { useAppDialogs } from '../DialogProvider';
import { useReservationForm } from './ReservationFormContext';
import { formatCurrency, displayDate } from '../../utils/formatters';
import { COMPLEMENT_LABELS } from '../../constants/complements';

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
 * One collectible complement: title + amount, optional itemised lines, « payé » / « caisse interne »
 * toggles and the payment date. Shared by the arrival complement, the end-of-stay complement and the
 * merged « complément de fin de séjour » of a deferred reservation
 * (specs/defer-arrival-complement-to-checkout.md §3.2), so the three can never drift apart visually.
 *
 * Props: `title`, `amount`, `lines` ([{ label, amount }], optional), `paid`, `paidCash`, `paidDate`,
 * `sectionGridSx`, and the three handlers `onTogglePaid(next)` / `onToggleCash(next)` / `onDateChange(v)`.
 */
function ComplementCard({ title, amount, lines = [], paid, paidCash, paidDate, sectionGridSx, onTogglePaid, onToggleCash, onDateChange }) {
  return (
    <>
      <Divider />
      <Box>
        <Grid container spacing={2} sx={sectionGridSx}>
          <Grid size={{ xs: 12, md: 6 }}>
            {/* Red border tant qu'impayé pour signaler le reste à percevoir ; bascule en visuel
                neutre (= Acompte/Solde payé) une fois le complément encaissé. */}
            <Box
              sx={{
                border: paid ? 'none' : '1px solid',
                borderColor: paid ? 'transparent' : 'error.main',
                borderRadius: 1,
                p: paid ? 0 : 1.5,
              }}
            >
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
              <Button
                fullWidth
                variant={paid ? 'contained' : 'outlined'}
                color={paid ? 'success' : 'inherit'}
                onClick={() => onTogglePaid(!paid)}
                sx={{ textTransform: 'none', justifyContent: 'flex-start', mt: lines.length ? 1.5 : 0 }}
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
          </Grid>
        </Grid>
      </Box>
    </>
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [refundHistoryOpen, setRefundHistoryOpen] = useState(false);

  // specs/defer-arrival-complement-to-checkout.md §3.2 — « En fin de séjour » chosen on the check-in
  // recap: there is only ONE collection left, at the door. The server ships the merged block
  // (`checkoutComplement`: total + arrival & end-of-stay lines + paid state); the fiche just renders
  // it in place of the two separate cards.
  const checkoutComplement = form.checkoutComplement || null;
  // specs/complement-buckets-by-moment.md §3 rule 4 — the merged card is now driven by the SPLIT, not
  // by the deferral flag alone: an arrival complement left unsettled once the guest is in is collected
  // at the door too, whether or not the operator answered « En fin de séjour » at check-in. The server
  // has already moved it, so `split.arrival === 0` is exactly the « one collection left » case.
  const complementSplit = pricingQuote?.complementSplit || null;
  const complementDeferred = Boolean(checkoutComplement?.deferred || (complementSplit && complementSplit.arrival === 0))
    && Number(checkoutComplement?.amount || 0) > 0;

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

  const onCancelNote = async (note) => {
    const ok = await confirm({
      title: 'Annuler cet encaissement ?',
      message: 'Les prestations redeviennent à percevoir en fin de séjour.',
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
              // When the platform COLLECTS the tourist tax AND remits it to the commune itself
              // (`touristTaxOfferedByPlatform`, case « platform »), the brut the guest paid includes that
              // tax and the platform withholds it from the virement on top of its commission. Subtract it
              // here, otherwise the computed commission is over-stated by the tourist tax — and so is the
              // commission booked in compta (specs/platform-commission-minus-offered-tax.md).
              const offeredTouristTax = Boolean(pricingQuote?.touristTaxOfferedByPlatform)
                ? Number(pricingQuote?.touristTaxOriginalTotal || 0)
                : 0;
              const platformGrossFilled = form.platformGrossAmount !== '' && form.platformGrossAmount != null;
              const platformPayoutFilled = form.platformPayoutAmount !== '' && form.platformPayoutAmount != null;
              const canComputeCommission = platformGrossFilled && platformPayoutFilled && !isReservationLocked;
              const computeCommissionFromPayout = () => {
                const grossNum = Number(form.platformGrossAmount);
                const payoutNum = Number(form.platformPayoutAmount);
                if (!Number.isFinite(grossNum) || !Number.isFinite(payoutNum)) return;
                const acompteComm = Number(form.acompteCommissionAmount) || 0;
                const soldeComm = Math.max(0, Math.round((grossNum - payoutNum - acompteComm - offeredTouristTax) * 100) / 100);
                updateForm({ platformCommissionAmount: soldeComm });
              };
              return (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem', mb: 1.5 }}>Paiement plateforme</Typography>
                    <Grid container spacing={2} sx={{ ...sectionGridSx, alignItems: 'flex-start' }}>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <ArithmeticTextField
                          label="Montant total payé par le client"
                          value={form.platformGrossAmount ?? ''}
                          onCommit={(v) => updateForm({ platformGrossAmount: v })}
                          fullWidth
                          size="small"
                          helperText="Le brut facturé par la plateforme — l'hébergement s'ajuste automatiquement (brut − options)."
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
                      <Tooltip title={canComputeCommission ? 'Commission solde = montant client − virement (− commission acompte éventuelle)' : 'Renseignez le montant client et le virement reçu'}>
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
                          if (isReservationLocked && editingReservationId) {
                            await api.markPayment(editingReservationId, { depositPaid: next, depositPaidDate: date || null });
                          }
                          updateForm({ depositPaid: next, depositPaidDate: date });
                        }}
                        sx={{ mt: 1.5, textTransform: 'none', justifyContent: 'flex-start' }}
                      >
                        {form.depositPaid ? 'Acompte payé' : 'Marquer acompte payé'}
                      </Button>
                      {form.depositPaid && (
                        <DateField
                          label="Payé le"
                          type="date"
                          value={form.depositPaidDate || ''}
                          onChange={async (e) => {
                            const v = e.target.value;
                            updateForm({ depositPaidDate: v });
                            if (isReservationLocked && editingReservationId) {
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
                      if (isReservationLocked && editingReservationId) {
                        await api.markPayment(editingReservationId, { balancePaid: next, balancePaidDate: date || null });
                      }
                      updateForm({ balancePaid: next, balancePaidDate: date });
                    }}
                    sx={{ mt: 1.5, textTransform: 'none', justifyContent: 'flex-start' }}
                  >
                    {form.balancePaid ? 'Solde payé' : 'Marquer solde payé'}
                  </Button>
                  {form.balancePaid && (
                    <DateField
                      label="Payé le"
                      type="date"
                      value={form.balancePaidDate || ''}
                      onChange={async (e) => {
                        const v = e.target.value;
                        updateForm({ balancePaidDate: v });
                        if (isReservationLocked && editingReservationId) {
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

            {/* Deferred to check-out (specs/defer-arrival-complement-to-checkout.md §3.2 rules 6-8):
                ONE card for ONE collection — the arrival lines and the end-of-stay lines together,
                one total, one « payé » action (the server settles both buckets). */}
            {complementDeferred && (
              <ComplementCard
                title={COMPLEMENT_LABELS.endOfStay}
                amount={checkoutComplement.amount}
                lines={checkoutComplement.lines || []}
                paid={form.complementPaid}
                paidCash={form.complementPaidCash}
                paidDate={form.complementPaidDate}
                sectionGridSx={sectionGridSx}
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
            )}

            {!complementDeferred && Number(pricingQuote?.complementAmount || 0) > 0 && (
              <ComplementCard
                title={COMPLEMENT_LABELS.arrival}
                amount={pricingQuote.complementAmount}
                paid={form.complementPaid}
                paidCash={form.complementPaidCash}
                paidDate={form.complementPaidDate}
                sectionGridSx={sectionGridSx}
                onTogglePaid={async (next) => {
                  const date = next ? (form.complementPaidDate || todayStr()) : '';
                  if (isReservationLocked && editingReservationId) {
                    await api.markPayment(editingReservationId, { complementPaid: next, complementPaidDate: date || null });
                  }
                  updateForm({ complementPaid: next, complementPaidDate: date });
                }}
                onDateChange={async (v) => {
                  updateForm({ complementPaidDate: v });
                  if (isReservationLocked && editingReservationId) {
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
            )}

            {/* Complément durant le séjour (specs/mid-stay-notes.md §3.5 rule 17): running total of the
                settled notes + the « Nouvelle note » entry point + a browsable history. Placed
                between the two complements, in collection order. */}
            {showMidStayNotes && (
              <>
                <Divider />
                <Box>
                  <Grid container spacing={2} sx={sectionGridSx}>
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
                            <Box key={note.id} sx={{ mt: 1, pl: 1, borderLeft: '2px solid', borderColor: 'divider' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                  {displayNoteDate(note.paidDate)} — {formatCurrency(note.total)} — {note.paidCash ? 'Caisse interne' : 'CB'}
                                </Typography>
                                <Button
                                  size="small"
                                  color="error"
                                  disabled={endOfStaySettled}
                                  onClick={() => onCancelNote(note)}
                                  sx={{ textTransform: 'none', minWidth: 0 }}
                                >
                                  ✕
                                </Button>
                              </Box>
                              {(note.lines || []).map((line, i) => (
                                <Typography key={i} variant="body2" sx={{ color: 'text.secondary' }}>
                                  {line.label} : {formatCurrency(line.amount || 0)}
                                </Typography>
                              ))}
                            </Box>
                          ))}
                        </>
                      )}
                    </Grid>
                  </Grid>
                </Box>
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
              </>
            )}

            {!complementDeferred && Number(form.endOfStayComplementAmount || 0) > 0 && (
              <ComplementCard
                title={COMPLEMENT_LABELS.endOfStay}
                amount={form.endOfStayComplementAmount}
                lines={parseEndOfStayDetail(form.endOfStayComplementDetail)}
                paid={form.endOfStayComplementPaid}
                paidCash={form.endOfStayComplementPaidCash}
                paidDate={form.endOfStayComplementPaidDate}
                sectionGridSx={sectionGridSx}
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
