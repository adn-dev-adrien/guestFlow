/**
 * ResourceBookingSummary — the price of a resource booking, line by line, as the server built it
 * (specs/resource-booking-pricing-and-invoicing.md rules 3-6). Renders, never computes: every amount, the total and the
 * VAT are fields of the preview.
 *
 * Specific to the booking payload (`lines`, `vat`, `rateGrid`); the fiche's summary renders a reservation quote.
 *
 * Props:
 *   price      the preview answer `{ total, lines[], vat, rateGrid }`
 *   heading    ReactNode — « 19:00 → 21:00 · 2 h », shown on the first row
 *   pending    boolean — a newer answer is coming (the figures dim)
 *   offerSlot  ReactNode — rendered under the « Temps offert » line (the stepper), or null when read-only
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import { formatCurrency } from '../sdk';

const GRID_LABELS = { external: 'Tarif extérieur', guest: 'Tarif client du séjour' };

function Line({ label, detail, amount, children }) {
  const negative = amount < 0;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 1.5, py: 0.75, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
      <Typography variant="body2">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: negative ? 'success.main' : 'text.primary' }}>
        {negative ? `−${formatCurrency(-amount)}` : formatCurrency(amount)}
      </Typography>
      {detail ? <Typography variant="caption" color="text.secondary" sx={{ gridColumn: 1 }}>{detail}</Typography> : null}
      {children ? <Box sx={{ gridColumn: '1 / -1', pt: 0.5 }}>{children}</Box> : null}
    </Box>
  );
}

export default function ResourceBookingSummary({ price, heading, pending = false, offerSlot = null }) {
  const offered = (price.lines || []).find((l) => l.key === 'offered');
  const others = (price.lines || []).filter((l) => l.key !== 'offered');
  return (
    <Box aria-busy={pending} sx={{ opacity: pending ? 0.55 : 1, transition: 'opacity 150ms ease-out', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{heading}</Typography>
        {price.rateGrid ? <Typography variant="caption" color="text.secondary">{GRID_LABELS[price.rateGrid] || ''}</Typography> : null}
      </Box>
      <Box sx={{ mt: 0.5 }}>
        {others.map((l) => <Line key={l.key} label={l.label} detail={l.detail} amount={l.amount} />)}
        {(offered || offerSlot) && (
          <Line label="Temps offert" detail={offerSlot ? null : (offered ? offered.detail : 'Aucun')} amount={offered ? offered.amount : 0}>
            {offerSlot}
          </Line>
        )}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', pt: 1, mt: 0.5, borderTop: 1, borderColor: 'text.primary' }}>
        <Typography variant="body2">Total TTC</Typography>
        <Typography sx={{ fontFamily: (t) => t.typography.pageTitle.fontFamily, fontWeight: 700, fontSize: '1.3rem', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(price.total)}</Typography>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {price.vat ? `dont TVA ${String(price.vat.rate).replace('.', ',')} % : ${formatCurrency(price.vat.amount)} · HT ${formatCurrency(price.vat.net)}` : 'TVA non applicable'}
      </Typography>
    </Box>
  );
}
