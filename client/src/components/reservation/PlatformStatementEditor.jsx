/**
 * PlatformStatementEditor — the statement fields of a platform payout row, opened from its amount
 * (specs/reservation-payment-ledger.md rule 25). The levers are the ones the fiche always had — « Total
 * facturé par la plateforme » / « Montant total payé par le client », « Taxe de séjour retenue », the
 * per-échéance commissions — with their labels, helpers and server rules unchanged
 * (platform-payment-entry, platform-per-echeance-commission, platform-tourist-tax-out-of-the-commission).
 * The figures are a draft until « Valider », which applies them to the form; « Annuler » leaves the
 * fiche as it was. Saved with the fiche, as before.
 *
 * Props:
 *   form, pricingQuote: the fiche's state and live quote
 *   withDepositCommission: the platform takes an acompte (its commission field shows)
 *   locked: past-locked fiche
 *   onApply(patch), onCancel()
 *   computeCommission(figures) → { commission } — « Calculer la commission » (server)
 *   reservationId?, canDeclarePenalty?, onPenaltiesChanged?() — the penalties of a stored stay
 *     (specs/reconciliation-assisted-matching.md rules 24, 30): lines, « Déclarer une pénalité », delete
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import api from '../../api';
import PlatformPenaltyDialog from './PlatformPenaltyDialog';
import { useAppDialogs, useToast } from '../DialogProvider';
import ArithmeticTextField from '../ArithmeticTextField';
import { formatCurrency } from '../../utils/formatters';

const blank = (v) => v === '' || v == null;

export default function PlatformStatementEditor({
  form, pricingQuote, withDepositCommission, locked, onApply, onCancel, computeCommission, onError,
  reservationId = null, canDeclarePenalty = false, onPenaltiesChanged,
}) {
  const { confirm } = useAppDialogs();
  const { showError, showSuccess } = useToast();
  const [penalties, setPenalties] = useState([]);
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const loadPenalties = useCallback(async () => {
    if (!reservationId) return;
    try { setPenalties((await api.listPlatformPenalties(reservationId)).items || []); } catch { setPenalties([]); }
  }, [reservationId]);
  useEffect(() => { loadPenalties(); }, [loadPenalties]);
  const changed = async () => { await loadPenalties(); if (onPenaltiesChanged) await onPenaltiesChanged(); };
  const removePenalty = async (penalty) => {
    const ok = await confirm({ title: 'Supprimer la pénalité ?', message: `${penalty.reason} · ${formatCurrency(penalty.amount)}`, confirmLabel: 'Supprimer' });
    if (!ok) return;
    try {
      const answer = await api.removePlatformPenalty(reservationId, penalty.id);
      showSuccess(answer.message || 'Pénalité supprimée.');
      await changed();
    } catch (err) { showError(err?.message || 'Suppression impossible.'); }
  };

  const [draft, setDraft] = useState({
    platformGrossAmount: form.platformGrossAmount ?? '',
    platformTouristTaxAmount: form.platformTouristTaxAmount ?? '',
    acompteCommissionAmount: form.acompteCommissionAmount ?? '',
    platformCommissionAmount: form.platformCommissionAmount ?? '',
  });
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  // Which number to copy off the statement depends on the platform's tourist-tax mode, so the field
  // says it (specs/platform-brut-excludes-offered-tourist-tax.md §6).
  const taxOffered = Boolean(pricingQuote?.touristTaxOfferedByPlatform);
  const taxReversed = Boolean(pricingQuote?.touristTaxReversedByPlatform);
  const withheldFilled = !blank(draft.platformTouristTaxAmount);
  const grossLabel = taxOffered && !withheldFilled ? 'Total séjour facturé par la plateforme' : 'Montant total payé par le client';
  const grossHelper = taxOffered
    ? (withheldFilled
      ? 'Total du relevé, taxe de séjour comprise. La taxe saisie ci-dessous en est déduite.'
      : "Hébergement + options, hors taxe de séjour et hors frais de dossier — l'hébergement s'ajuste automatiquement.")
    : taxReversed
      ? 'Taxe de séjour comprise — la plateforme la reverse avec le virement.'
      : "L'hébergement s'ajuste automatiquement (brut − options). La taxe de séjour est encaissée à l'arrivée.";
  const engineTouristTax = Number(pricingQuote?.touristTaxOriginalTotal || 0);
  const canCompute = !blank(draft.platformGrossAmount) && !blank(form.platformPayoutAmount) && !locked;

  const compute = async () => {
    try {
      const { commission } = await computeCommission({
        gross: draft.platformGrossAmount,
        payout: form.platformPayoutAmount,
        touristTax: draft.platformTouristTaxAmount,
        acompteCommission: draft.acompteCommissionAmount,
      });
      set({ platformCommissionAmount: commission });
    } catch (err) {
      if (onError) onError(err.message || 'Calcul impossible');
    }
  };

  return (
    <Box
      sx={{
        mt: 1.25, p: 1.25, borderRadius: 1.5, bgcolor: 'background.default', display: 'grid', gap: 1.25,
        gridTemplateColumns: '1fr',
        '@container (min-width: 600px)': { gridTemplateColumns: '1fr 1fr' },
        animation: 'ledgerOpen 200ms ease-out',
        '@keyframes ledgerOpen': { from: { opacity: 0, transform: 'translateY(-4px)' }, to: { opacity: 1, transform: 'none' } },
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}
    >
      <ArithmeticTextField
        label={grossLabel}
        value={draft.platformGrossAmount}
        onCommit={(v) => set({ platformGrossAmount: v })}
        size="small"
        helperText={grossHelper}
        disabled={locked}
        autoFocus
      />
      {taxOffered && (
        <Box>
          <ArithmeticTextField
            label="Taxe de séjour retenue"
            value={draft.platformTouristTaxAmount}
            onCommit={(v) => set({ platformTouristTaxAmount: v })}
            size="small"
            fullWidth
            disabled={locked}
            helperText="Collectée par la plateforme et reversée à la commune — jamais encaissée par l’établissement."
          />
          <Tooltip title={`Reprendre le calcul du moteur : ${formatCurrency(engineTouristTax)}`}>
            <span>
              <Button size="small" variant="text" disabled={locked} onClick={() => set({ platformTouristTaxAmount: engineTouristTax })} sx={{ textTransform: 'none', minHeight: 44 }}>
                Reprendre le calcul
              </Button>
            </span>
          </Tooltip>
          {/* specs/platform-tourist-tax-out-of-the-commission.md rule 12 — the amount that carries the
              VAT, no longer the number typed above once the box holds something. */}
          {withheldFilled && !blank(draft.platformGrossAmount) && Number.isFinite(Number(draft.platformGrossAmount)) && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Montant hors taxe de séjour : <strong>{formatCurrency(Math.round((Number(draft.platformGrossAmount) - Math.max(0, Number(draft.platformTouristTaxAmount) || 0)) * 100) / 100)}</strong> — base TVA et base de commission.
            </Typography>
          )}
        </Box>
      )}
      {withDepositCommission && (
        <ArithmeticTextField
          label="Commission acompte (€)"
          value={draft.acompteCommissionAmount}
          onCommit={(v) => set({ acompteCommissionAmount: v })}
          size="small"
          disabled={locked}
          helperText="Frais retenus sur l'acompte."
        />
      )}
      <Box>
        <ArithmeticTextField
          label="Commission solde (€)"
          value={draft.platformCommissionAmount}
          onCommit={(v) => set({ platformCommissionAmount: v })}
          size="small"
          fullWidth
          disabled={locked}
          helperText="Frais retenus sur le solde."
        />
        {!blank(form.platformPayoutAmount) && (
          <Tooltip title={canCompute ? 'Commission solde = total facturé − virement (− taxe retenue, − commission acompte)' : 'Renseigner le total facturé'}>
            <span>
              <Button size="small" variant="text" disabled={!canCompute} onClick={compute} sx={{ textTransform: 'none', minHeight: 44 }}>
                Calculer la commission
              </Button>
            </span>
          </Tooltip>
        )}
      </Box>
      <Stack direction="row" spacing={0.75} sx={{ gridColumn: '1 / -1', flexWrap: 'wrap' }}>
        <Button variant="contained" disabled={locked} onClick={() => onApply(draft)} sx={{ minHeight: 44, borderRadius: 999, textTransform: 'none' }}>
          Valider
        </Button>
        <Button variant="text" onClick={onCancel} sx={{ minHeight: 44, textTransform: 'none' }}>Annuler</Button>
      </Stack>
      {!blank(form.platformPayoutAmount) && (
        <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
          Virement reçu : {formatCurrency(form.platformPayoutAmount)}
        </Typography>
      )}
      {reservationId && (penalties.length > 0 || canDeclarePenalty) && (
        <Box sx={{ gridColumn: '1 / -1' }}>
          {penalties.map((p) => (
            <Stack key={p.id} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                Pénalité · {p.reason} · −{formatCurrency(p.amount)} · {p.dateLabel}
              </Typography>
              <Tooltip title="Supprimer la pénalité">
                <span><IconButton aria-label="Supprimer la pénalité" disabled={locked} onClick={() => removePenalty(p)} sx={{ minWidth: 44, minHeight: 44 }}><DeleteIcon fontSize="small" /></IconButton></span>
              </Tooltip>
            </Stack>
          ))}
          {canDeclarePenalty && (
            <Button size="small" variant="text" onClick={() => setPenaltyOpen(true)} sx={{ textTransform: 'none', minHeight: 44 }}>Déclarer une pénalité</Button>
          )}
          <PlatformPenaltyDialog open={penaltyOpen} onClose={() => setPenaltyOpen(false)} reservationId={reservationId} source="fiche" onDone={changed} />
        </Box>
      )}
    </Box>
  );
}
