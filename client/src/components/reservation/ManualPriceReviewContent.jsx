/**
 * ManualPriceReviewContent — the explanation of the « Tarif modifié » review (specs/manual-price-on-placement-change.md §3.3, §6):
 * tariff before → after, nights and season groups « Avant / Après » (stacked on xs), the current manual price and its gap. Renders
 * the server's `manualPriceReview` as is; `manualPriceChoices(review)` shapes its choices for `ChoiceDialog`.
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import { formatCurrency, displayDateShort } from '../../utils/formatters';

export const MANUAL_PRICE_REVIEW_TEXT = {
  title: 'Tarif modifié',
  confirm: 'Appliquer',
  cancel: 'Annuler le changement',
  ariaLabel: "Prix de l'hébergement",
  tariff: 'Tarif hébergement',
  before: 'Avant',
  after: 'Après',
  manualPrice: 'Prix ajusté',
  equalToTariff: 'égal au tarif',
  onTariff: 'sur le tarif',
  totalStay: 'Total séjour',
  choices: {
    keep: 'Garder le prix ajusté',
    keepGap: "Garder l'écart",
    engine: 'Appliquer le tarif',
  },
  engineCaption: 'Prix ajusté retiré',
};

const T = MANUAL_PRICE_REVIEW_TEXT;
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatCurrency(Math.abs(n))}`;
const nightsLabel = (n) => `${n} nuit${n > 1 ? 's' : ''}`;

export function manualPriceChoices(review) {
  return (review?.choices || []).map((choice) => {
    const total = choice.totalStay != null ? `${T.totalStay} ${formatCurrency(choice.totalStay)}` : '';
    const lead = choice.key === 'keepGap'
      ? `${formatCurrency(review.placement.totalPrice)} ${review.gap < 0 ? '−' : '+'} ${formatCurrency(Math.abs(review.gap))}`
      : choice.key === 'engine' ? T.engineCaption : '';
    return {
      value: choice.key,
      label: T.choices[choice.key],
      figure: formatCurrency(choice.finalPrice),
      caption: [lead, total].filter(Boolean).join(' · '),
      disabledReason: choice.disabledReason,
    };
  });
}

function Side({ title, side, showProperty }) {
  return (
    <Box sx={{ bgcolor: 'background.paper', borderRadius: '8px', px: 1.25, py: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="body2">
          {displayDateShort(side.startDate)} → {displayDateShort(side.endDate)} · {nightsLabel(side.nights)}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>{formatCurrency(side.totalPrice)}</Typography>
      </Box>
      {(side.seasons || []).map((season) => (
        <Box key={season.label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">{season.label} · {nightsLabel(season.nights)}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{formatCurrency(season.amount)}</Typography>
        </Box>
      ))}
      {showProperty && side.propertyName && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{side.propertyName}</Typography>
      )}
    </Box>
  );
}

export default function ManualPriceReviewContent({ review }) {
  if (!review) return null;
  const propertyMoved = review.reference.propertyId !== review.placement.propertyId;
  return (
    <Box sx={{ bgcolor: 'background.default', borderRadius: '10px', p: 1.5, display: 'grid', gap: 1, fontVariantNumeric: 'tabular-nums' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2">{T.tariff}</Typography>
        <Typography sx={{ fontWeight: 700 }}>
          {formatCurrency(review.reference.totalPrice)} → {formatCurrency(review.placement.totalPrice)}{' '}
          <Typography component="span" variant="caption" color="text.secondary">({signed(review.tariffDelta)})</Typography>
        </Typography>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
        <Side title={T.before} side={review.reference} showProperty={propertyMoved} />
        <Side title={T.after} side={review.placement} showProperty={propertyMoved} />
      </Box>
      <Typography variant="body2" color="text.secondary">
        {T.manualPrice} : <Box component="b" sx={{ color: 'text.primary' }}>{formatCurrency(review.customPrice)}</Box>{' '}
        ({review.gap === 0 ? T.equalToTariff : `${signed(review.gap)} ${T.onTariff}`})
      </Typography>
    </Box>
  );
}
