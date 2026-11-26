/**
 * PlatformStatementEditor — the statement fields of a platform payout row, opened from its amount
 * (specs/payments/reservation-payment-ledger.md rule 25). Since specs/platforms/platform-host-statement-and-commission-vat.md the block takes the HOST side
 * of the platform's statement: « Location (relevé) » and « Options (relevé) » (their sum is the host amount the fiche stores), the tourist-tax
 * box whose meaning follows the platform's mode (labelled by the server), the per-échéance commissions and « Calculer la commission ». Under
 * them, the server's own reading of the figures: the closing line, the tax gap, the commission's booking, the option lines it adjusted — all
 * worded by the server; a refusal sits on its field, a commission rate that looks off is a warning on the commission field.
 * The figures are a draft until « Valider », which applies them to the form; « Annuler » leaves the fiche as it was.
 *
 * Props:
 *   form, pricingQuote: the fiche's state and live quote (`pricingQuote.platformStatement.box` names the box of the platform's mode)
 *   withDepositCommission: the platform takes an acompte (its commission field shows)
 *   locked: past-locked fiche
 *   onApply(patch), onCancel()
 *   computeCommission(figures) → { commission } — « Calculer la commission » (server)
 *   received: { net, label } | null — the payout already received: its transfer is a field, prefilled, editable
 *     (specs/platforms/platform-statement-after-payout.md rules 3, 8)
 *   preview(statement) → { lines, warnings, refusals } — the server's reading of the typed statement, nothing written
 *     (the statement of a received or locked stay is read by its own endpoint, a draft by the fiche's quote)
 *   lockedReason: why the fields are disabled, shown under them
 */
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, Tooltip, Typography } from '@mui/material';
import ArithmeticTextField from '../ArithmeticTextField';
import { formatCurrency } from '../../utils/formatters';

const blank = (v) => v === '' || v == null;
const cents = (v) => Math.round((Number(v) || 0) * 100);

const PREVIEW_DELAY_MS = 250;
const TONE_SEVERITY = { done: 'success', warning: 'warning', error: 'error', info: 'info' };

// The two figures the operator types are held apart; the fiche stores their sum and the options figure.
const locationOf = (gross, options) => (blank(gross) ? '' : (cents(gross) - cents(options)) / 100);
const hostAmountOf = (location, options) => (blank(location) && blank(options) ? '' : (cents(location) + cents(options)) / 100);

export default function PlatformStatementEditor({
  form, pricingQuote, withDepositCommission, locked, onApply, onCancel, computeCommission, onError,
  received = null, preview = null, lockedReason = null,
}) {
  const [draft, setDraft] = useState({
    platformLocationAmount: locationOf(form.platformGrossAmount, form.platformOptionsAmount),
    platformOptionsAmount: form.platformOptionsAmount ?? '',
    platformTouristTaxAmount: form.platformTouristTaxAmount ?? '',
    acompteCommissionAmount: form.acompteCommissionAmount ?? '',
    platformCommissionAmount: form.platformCommissionAmount ?? '',
    ...(received ? { platformPayoutAmount: received.net } : {}),
  });
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  // The server's reading of the typed figures: its lines, its warnings, the refusals it would answer.
  const [reading, setReading] = useState({ lines: [], warnings: {}, refusals: {} });
  const platformGrossAmount = hostAmountOf(draft.platformLocationAmount, draft.platformOptionsAmount);
  // The transfer the commission is computed from: the panel's own field on a received payout (rule 3), else the fiche's.
  const payoutForCompute = received ? draft.platformPayoutAmount : form.platformPayoutAmount;
  const statement = {
    platformGrossAmount,
    platformOptionsAmount: draft.platformOptionsAmount,
    platformTouristTaxAmount: draft.platformTouristTaxAmount,
    acompteCommissionAmount: draft.acompteCommissionAmount,
    platformCommissionAmount: draft.platformCommissionAmount,
    ...(received ? { platformPayoutAmount: draft.platformPayoutAmount } : { platformPayoutAmount: form.platformPayoutAmount }),
  };

  useEffect(() => {
    // A reading of the previous figures is never shown against the new ones (review L3).
    setReading({ lines: [], warnings: {}, refusals: {} });
    if (!preview || locked) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const answer = await preview(statement);
        if (!live || !answer) return;
        const lines = Array.isArray(answer.lines) && answer.lines.length > 0 ? answer.lines : (answer.netLabel ? [answer.netLabel] : []);
        setReading({ lines, warnings: answer.warnings || {}, refusals: answer.refusals || {} });
      } catch (err) {
        if (!live) return;
        if (err && err.field) setReading({ lines: [], warnings: {}, refusals: { [err.field]: err.message || 'Relevé refusé.' } });
        else setReading({ lines: [{ tone: 'error', label: err.message || 'Relevé refusé.' }], warnings: {}, refusals: {} });
      }
    }, PREVIEW_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
    // The statement is rebuilt on every render: it is its figures that start a reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, locked, draft]);

  const box = pricingQuote?.platformStatement?.box || null;
  const engineTouristTax = Number(pricingQuote?.touristTaxOriginalTotal || 0);
  const refusals = reading.refusals;
  const hasRefusal = Object.keys(refusals).length > 0 || reading.lines.some((l) => l.tone === 'error');
  const canCompute = !blank(platformGrossAmount) && !blank(payoutForCompute) && !locked;

  const compute = async () => {
    try {
      const { commission } = await computeCommission({
        platform: form.platform,
        gross: platformGrossAmount,
        payout: payoutForCompute,
        touristTax: draft.platformTouristTaxAmount,
        acompteCommission: draft.acompteCommissionAmount,
      });
      set({ platformCommissionAmount: commission });
    } catch (err) {
      if (onError) onError(err.message || 'Calcul impossible');
    }
  };

  const apply = () => {
    const { platformLocationAmount, ...figures } = draft;
    onApply({ ...figures, platformGrossAmount });
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
      {received && (
        <ArithmeticTextField
          label={received.label}
          value={draft.platformPayoutAmount}
          onCommit={(v) => set({ platformPayoutAmount: v })}
          size="small"
          helperText="Total versé par la plateforme pour ce séjour, tel qu’il est arrivé sur le compte."
          disabled={locked}
        />
      )}
      <ArithmeticTextField
        label="Location (relevé)"
        value={draft.platformLocationAmount}
        onCommit={(v) => set({ platformLocationAmount: v })}
        size="small"
        helperText="Le loyer du relevé de la plateforme : sans taxe de séjour ni frais facturés au voyageur."
        disabled={locked}
        autoFocus
      />
      <ArithmeticTextField
        label="Options (relevé)"
        value={draft.platformOptionsAmount}
        onCommit={(v) => set({ platformOptionsAmount: v })}
        size="small"
        error={Boolean(refusals.platformOptionsAmount)}
        helperText={refusals.platformOptionsAmount || 'Ménage, linge… facturés par la plateforme. Vide : les options de la fiche restent telles quelles.'}
        disabled={locked}
      />
      {box && (
        <Box>
          <ArithmeticTextField
            label={box.label}
            value={draft.platformTouristTaxAmount}
            onCommit={(v) => set({ platformTouristTaxAmount: v })}
            size="small"
            fullWidth
            disabled={locked}
            helperText={box.helper}
          />
          {box.mode === 'platform' && (
            <Tooltip title={`Reprendre le calcul du moteur : ${formatCurrency(engineTouristTax)}`}>
              <span>
                <Button size="small" variant="text" disabled={locked} onClick={() => set({ platformTouristTaxAmount: engineTouristTax })} sx={{ textTransform: 'none', minHeight: 44 }}>
                  Reprendre le calcul
                </Button>
              </span>
            </Tooltip>
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
          error={Boolean(refusals.platformCommissionAmount)}
          color={reading.warnings.commissionRate ? 'warning' : undefined}
          focused={reading.warnings.commissionRate ? true : undefined}
          disabled={locked}
          helperText={refusals.platformCommissionAmount || reading.warnings.commissionRate || 'Frais retenus sur le solde.'}
        />
        {!blank(payoutForCompute) && (
          <Tooltip title={canCompute ? 'Commission solde = montant hôte (+ taxe versée avec le virement) − virement − commission acompte' : 'Renseigner la location'}>
            <span>
              <Button size="small" variant="text" disabled={!canCompute} onClick={compute} sx={{ textTransform: 'none', minHeight: 44 }}>
                Calculer la commission
              </Button>
            </span>
          </Tooltip>
        )}
      </Box>
      {reading.lines.length > 0 && (
        <Stack spacing={0.75} sx={{ gridColumn: '1 / -1', fontVariantNumeric: 'tabular-nums' }}>
          {reading.lines.map((line) => (
            <Alert key={line.label} severity={TONE_SEVERITY[line.tone] || 'info'} role="status">{line.label}</Alert>
          ))}
        </Stack>
      )}
      {locked && lockedReason && (
        <Typography variant="body2" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>{lockedReason}</Typography>
      )}
      <Stack direction="row" spacing={0.75} sx={{ gridColumn: '1 / -1', flexWrap: 'wrap' }}>
        <Button variant="contained" disabled={locked || hasRefusal} onClick={apply} sx={{ minHeight: 44, borderRadius: 999, textTransform: 'none' }}>
          Valider
        </Button>
        <Button variant="text" onClick={onCancel} sx={{ minHeight: 44, textTransform: 'none' }}>Annuler</Button>
      </Stack>
      {!received && !blank(form.platformPayoutAmount) && (
        <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
          Virement reçu : {formatCurrency(form.platformPayoutAmount)}
        </Typography>
      )}
    </Box>
  );
}
