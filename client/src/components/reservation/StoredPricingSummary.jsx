/**
 * StoredPricingSummary — the « Résumé tarifaire » of a stay whose stored money differs from today's
 * quote, while the fiche shows the stored ledger (specs/reservation-payment-ledger.md rules 44-45).
 *
 * Every figure and date comes from the stored row as the server shaped it (`storedSummary`): nothing
 * from the live quote is printed next to it, and the per-night / per-option detail of the quote — which
 * no longer adds up to the stored total — is left out. Modifying the fiche brings the live summary back.
 *
 * Specific to the reservation fiche.
 *
 * Props:
 *   summary:          the server's `storedSummary`
 *   form:             the fiche (paid flags, caution, deposit opt-out)
 *   propertyLabel:    the property's name
 *   isPlatform:       the stay was sold by a platform (« Vous percevez » cascade)
 */
import React from 'react';
import { Box, Card, Divider, Stack, Typography } from '@mui/material';
import StatusBadge from '../StatusBadge';
import { formatCurrency, displayDate } from '../../utils/formatters';

function Row({ label, value, strong = false, sign = '', caption = false }) {
  const variant = caption ? 'caption' : 'body2';
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
      <Typography variant={variant} color={strong ? 'text.primary' : 'text.secondary'} sx={{ fontWeight: strong ? 700 : 400 }}>{label}</Typography>
      <Typography variant={variant} sx={{ fontWeight: strong ? 700 : 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {sign}{formatCurrency(value)}
      </Typography>
    </Box>
  );
}

export default function StoredPricingSummary({ summary, form, propertyLabel, isPlatform }) {
  const s = summary || {};
  const totalStay = Number(s.totalStayPrice || 0);
  return (
    <Card variant="outlined" sx={{ bgcolor: 'background.paper', p: 2 }} data-testid="stored-pricing-summary">
      <Typography variant="sectionHeader" sx={{ mb: 1 }}>Résumé tarifaire</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1, overflowWrap: 'anywhere' }}>{propertyLabel || ''}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        Montants enregistrés. Le calcul actuel du séjour diffère : il s&apos;affiche dès que la fiche est modifiée.
      </Typography>
      <Stack spacing={1}>
        <Row label="Hébergement" value={s.accommodation} />
        {Number(s.optionsTotal) > 0 && <Row label="Options" value={s.optionsTotal} />}
        {Number(s.resourcesTotal) > 0 && <Row label="Ressources" value={s.resourcesTotal} />}
        {Number(s.touristTaxTotal) > 0 && <Row label="Taxe de séjour" value={s.touristTaxTotal} />}
        <Divider />
        <Row label="Total HT" value={s.totalNetPrice} caption />
        <Row label={`TVA ${s.vatRate}%`} value={s.totalVatAmount} caption />
        <Divider />
        <Row label="Total du séjour" value={totalStay} strong />
        {isPlatform && Number(s.totalPlatformCommission) > 0 && (
          <>
            <Row label="Commission plateforme" value={s.totalPlatformCommission} sign="− " />
            {s.platformNetReceivedAmount != null && <Row label="Versement plateforme" value={s.platformNetReceivedAmount} strong />}
          </>
        )}
        {s.sejourNetTotal != null && Math.abs(Number(s.sejourNetTotal) - totalStay) > 0.005 && (
          <Row label={isPlatform ? 'Vous percevez' : 'Total perçu'} value={s.sejourNetTotal} strong />
        )}
        <Divider />
        <Row label={isPlatform ? 'Montant acompte payé par le client' : 'Acompte'} value={s.depositAmount} />
        {!form.depositDisabled && Number(s.depositAmount) > 0 && s.depositDueDate && (
          <Typography variant="caption" color="text.secondary">À payer avant : {displayDate(s.depositDueDate)}</Typography>
        )}
        {form.depositPaid && <StatusBadge status="success" label="Acompte payé" />}
        <Divider />
        <Row label={isPlatform ? 'Montant solde payé par le client' : 'Solde'} value={s.balanceAmount} />
        {Number(s.balanceAmount) > 0 && s.balanceDueDate && (
          <Typography variant="caption" color="text.secondary">À payer avant : {displayDate(s.balanceDueDate)}</Typography>
        )}
        {form.balancePaid && <StatusBadge status="success" label="Solde payé" />}
        {/* A complement deferred to check-out reads as ONE end-of-stay complement, as on the ledger. */}
        {form.complementDeferredToCheckout ? (
          Number(s.complementAmount) + Number(s.endOfStayComplementTotal) > 0 && (
            <>
              <Divider />
              <Row label="Complément de fin de séjour" value={Number(s.complementAmount) + Number(s.endOfStayComplementTotal)} />
            </>
          )
        ) : (
          <>
            {Number(s.complementAmount) > 0 && (
              <>
                <Divider />
                <Row label="Complément d'arrivée" value={s.complementAmount} />
              </>
            )}
            {Number(s.endOfStayComplementTotal) > 0 && <Row label="Complément de fin de séjour" value={s.endOfStayComplementTotal} />}
          </>
        )}
        <Divider />
        <Row label="Caution" value={form.cautionAmount} />
        {form.cautionReceived && <StatusBadge status="success" label="Caution reçue" />}
        {form.cautionReturned && <StatusBadge status="info" label="Caution restituée" />}
      </Stack>
    </Card>
  );
}
