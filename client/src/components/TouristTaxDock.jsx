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
  const nothing = Number(t.amount || 0) === 0 && Number(t.platformRemittedAmount || 0) === 0;
  const pills = [
    [t.staysCount, TAX_DOCK.stays(t.staysCount), 'stays'],
    [t.persons, TAX_DOCK.persons(t.persons), 'persons'],
    [null, null, 'taxed'],
    [t.taxedPersonNights, TAX_DOCK.taxedNights(t.taxedPersonNights), 'personNights'],
  ];
  const caption = t.allDeclared ? TAX_DOCK.allDeclared : (Number(t.amount || 0) === 0 ? TAX_DOCK.nothing : TAX_DOCK.ofTotal(formatCurrency(t.amount)));
  const small = { fontSize: { xs: '1rem', md: '1.4rem' }, lineHeight: 1.15, fontWeight: 700, display: 'block', whiteSpace: 'nowrap', ...TABULAR };
  return (
    <Box
      component="section"
      aria-label={TAX_DOCK.label}
      aria-live="polite"
      data-nothing={nothing ? 'true' : undefined}
      sx={{
        position: 'sticky', bottom: 0, zIndex: 3, mt: { xs: 1.5, sm: 2.25 }, mb: { xs: 'calc(env(safe-area-inset-bottom) + 4px)', sm: 1 },
        borderRadius: { xs: 3, sm: 4 }, border: '1px solid', borderColor: 'divider',
        px: { xs: 1.5, sm: 2.25 }, py: { xs: 1, sm: 1.75 },
        display: 'grid', alignItems: 'center',
        columnGap: { xs: 1.5, md: 2 }, rowGap: { xs: 0.25, sm: 1.5, md: 2 },
        gridTemplateColumns: { xs: '1fr auto', sm: '1fr 1fr', md: '1.2fr 1fr 1fr 1.6fr' },
        bgcolor: alpha(theme.palette.background.paper, 0.86),
        backdropFilter: 'blur(14px) saturate(160%)',
        boxShadow: '0 -6px 20px rgba(39, 37, 31, 0.06)',
        '@media (prefers-reduced-transparency: reduce)': { bgcolor: 'background.paper', backdropFilter: 'none' },
      }}
    >
      <Box data-testid="total-amount" sx={{ gridRow: { xs: '1 / span 2', sm: 'auto' }, gridColumn: { sm: '1 / -1', md: 'auto' } }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>{TAX_DOCK.toRemit(windowLabel)}</Typography>
        <Typography component="b" sx={{ display: 'block', fontSize: { xs: '1.5rem', sm: '2rem' }, lineHeight: 1.1, letterSpacing: '-0.02em', color: 'primary.main', fontWeight: 700, ...TABULAR }}>
          {formatCurrency(t.remainingAmount)}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: { xs: 'nowrap', sm: 'normal' } }}>{caption}</Typography>
      </Box>
      <Box data-testid="total-declared" sx={{ display: 'flex', flexDirection: { xs: 'row', sm: 'column' }, gap: { xs: 1, sm: 0 }, alignItems: { xs: 'baseline', sm: 'stretch' }, justifyContent: { xs: 'space-between', sm: 'flex-start' } }}>
        <Typography variant="caption" color="text.secondary">{TAX_DOCK.declared}</Typography>
        <Typography component="b" sx={small}>{formatCurrency(t.declaredAmount)}</Typography>
      </Box>
      <Box data-testid="total-platforms" sx={{ display: 'flex', flexDirection: { xs: 'row', sm: 'column' }, gap: { xs: 1, sm: 0 }, alignItems: { xs: 'baseline', sm: 'stretch' }, justifyContent: { xs: 'space-between', sm: 'flex-start' } }}>
        <Typography variant="caption" color="text.secondary">{TAX_DOCK.platforms}</Typography>
        <Typography component="b" sx={small}>{formatCurrency(t.platformRemittedAmount)}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>{TAX_DOCK.platformStays(t.platformRemittedStaysCount)}</Typography>
      </Box>
      <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexWrap: 'wrap', gap: 0.75, gridColumn: { sm: '1 / -1', md: 'auto' } }}>
        {pills.map(([n, label, key]) => (
          <Box key={key} data-testid={`total-${key}`} sx={{ bgcolor: 'background.default', borderRadius: 99, px: 1.25, py: 0.625, fontSize: '0.8125rem' }}>
            {key === 'taxed'
              ? <><Box component="b" sx={TABULAR}>{t.taxedPersons}</Box>{` ${TAX_DOCK.taxed(t.taxedPersons)} · `}<Box component="b" sx={TABULAR}>{t.exemptPersons}</Box>{` ${TAX_DOCK.exempt(t.exemptPersons)}`}</>
              : <><Box component="b" sx={TABULAR}>{n}</Box>{` ${label}`}</>}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
