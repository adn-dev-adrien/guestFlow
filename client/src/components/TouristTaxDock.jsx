/**
 * TouristTaxDock — the bottom banner of the « Taxe de séjour » page (specs/tourist-tax-report-v2.md rule 59; mock
 * specs/tourist-tax-by-property-maquette.html): « À reverser » in large type (« sur … au total »), « Déjà déclaré »,
 * « Reversé par les plateformes » with its stays count, and the secondary counts as compact pills. Sticky, on a translucent
 * frosted surface (solid under `prefers-reduced-transparency`); nothing animates, so `prefers-reduced-motion` has nothing to
 * respect. Renders the server's `totals` as given.
 *
 * Props: totals (the report's totals), windowLabel (« août 2026 »), formatMoney (default formatCurrency)
 */
import React from 'react';
import { Box, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { formatCurrency } from '../utils/formatters';
import { TAX_DOCK } from '../constants/touristTaxReport';

const TABULAR = { fontVariantNumeric: 'tabular-nums' };

export default function TouristTaxDock({ totals, windowLabel }) {
  const theme = useTheme();
  const t = totals;
  const pills = [
    [t.staysCount, TAX_DOCK.stays(t.staysCount), 'stays'],
    [t.persons, TAX_DOCK.persons(t.persons), 'persons'],
    [null, TAX_DOCK.taxedExempt(t.taxedPersons, t.exemptPersons), 'taxed'],
    [t.taxedPersonNights, TAX_DOCK.taxedNights, 'personNights'],
  ];
  return (
    <Box
      component="section"
      aria-label={TAX_DOCK.label}
      aria-live="polite"
      sx={{
        position: 'sticky', bottom: 0, zIndex: 3, mt: 2.25, mb: 1, borderRadius: 4, border: '1px solid', borderColor: 'divider',
        px: { xs: 1.75, sm: 2.25 }, py: { xs: 1.5, sm: 1.75 },
        display: 'grid', gap: { xs: 1.5, md: 2 }, alignItems: 'center',
        gridTemplateColumns: { xs: '1fr 1fr', md: '1.2fr 1fr 1fr 1.6fr' },
        bgcolor: alpha(theme.palette.background.paper, 0.86),
        backdropFilter: 'blur(14px) saturate(160%)',
        boxShadow: '0 -6px 20px rgba(39, 37, 31, 0.06)',
        '@media (prefers-reduced-transparency: reduce)': { bgcolor: 'background.paper', backdropFilter: 'none' },
      }}
    >
      <Box data-testid="total-amount" sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}>
        <Typography variant="caption" color="text.secondary">{TAX_DOCK.toRemit(windowLabel)}</Typography>
        <Typography component="b" sx={{ display: 'block', fontSize: { xs: '1.75rem', sm: '2rem' }, lineHeight: 1.1, letterSpacing: '-0.02em', color: 'primary.main', fontWeight: 700, ...TABULAR }}>
          {formatCurrency(t.remainingAmount)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {t.allDeclared ? TAX_DOCK.allDeclared : TAX_DOCK.ofTotal(formatCurrency(t.amount))}
        </Typography>
      </Box>
      <Box data-testid="total-declared">
        <Typography variant="caption" color="text.secondary">{TAX_DOCK.declared}</Typography>
        <Typography component="b" sx={{ display: 'block', fontSize: '1.4rem', lineHeight: 1.15, fontWeight: 700, ...TABULAR }}>{formatCurrency(t.declaredAmount)}</Typography>
      </Box>
      <Box data-testid="total-platforms">
        <Typography variant="caption" color="text.secondary">{TAX_DOCK.platforms}</Typography>
        <Typography component="b" sx={{ display: 'block', fontSize: '1.4rem', lineHeight: 1.15, fontWeight: 700, ...TABULAR }}>{formatCurrency(t.platformRemittedAmount)}</Typography>
        <Typography variant="caption" color="text.secondary">{TAX_DOCK.platformStays(t.platformRemittedStaysCount)}</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, gridColumn: { xs: '1 / -1', md: 'auto' } }}>
        {pills.map(([n, label, key]) => (
          <Box key={key} data-testid={`total-${key}`} sx={{ bgcolor: 'background.default', borderRadius: 99, px: 1.25, py: 0.625, fontSize: '0.8125rem' }}>
            {n != null && <Box component="b" sx={TABULAR}>{n} </Box>}{label}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
