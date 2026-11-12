/**
 * TouristTaxPropertyCard — the head of one logement's section on the « Taxe de séjour » page
 * (specs/tourist-tax-report-v2.md rule 58; mock specs/tourist-tax-by-property-maquette.html): the logement's name behind a
 * coloured left edge, the total to declare in large type, what remains (or « tout est déclaré »), a declared / remaining bar,
 * three tiles, a note for the stays the platform remits, and the two actions of the logement. It joins the table below it
 * (square bottom corners). Render-only: every figure is the server's (`totals` = one `byProperty` entry).
 *
 * Props:
 *   totals:    one entry of the report's `byProperty` (propertyName, amount, declaredAmount, remainingAmount, allDeclared,
 *              toDeclareRowsCount, rowsCount, staysCount, taxedPersons, taxedPersonNights, platformRemittedStaysCount/Amount)
 *   color:     string   the left edge's colour
 *   busy:      boolean  « Marquer … déclaré » is on its way
 *   canDeclare: boolean the server says a row of this logement can be ticked (a declarable one is left)
 *   onDeclare, onExport: () => void
 */
import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { formatCurrency } from '../utils/formatters';
import { TAX_PROPERTY } from '../constants/touristTaxReport';

const TABULAR = { fontVariantNumeric: 'tabular-nums' };

export default function TouristTaxPropertyCard({ totals, color, busy = false, canDeclare = true, onDeclare, onExport }) {
  const name = totals.propertyName;
  const total = Number(totals.amount || 0);
  const declared = Number(totals.declaredAmount || 0);
  const pct = total > 0 ? Math.min(100, Math.max(0, (declared / total) * 100)) : 0;
  const remaining = Number(totals.remainingAmount || 0);
  const hasPlatform = Number(totals.platformRemittedStaysCount || 0) > 0;
  const nothingLeft = totals.allDeclared || totals.toDeclareRowsCount === 0 || !canDeclare;
  return (
    <Box
      component="section"
      aria-label={name}
      data-property-card={totals.propertyId}
      sx={{
        position: 'relative', overflow: 'hidden', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
        borderBottom: 0, borderRadius: '14px 14px 0 0', p: { xs: 1.75, sm: 2.25 },
        '&::before': { content: '""', position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, bgcolor: color },
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="sectionHeader" component="h3" sx={{ fontSize: '1.125rem' }}>{name}</Typography>
        <Typography variant="caption" color="text.secondary">{TAX_PROPERTY.stays(totals.staysCount)}</Typography>
      </Box>
      <Typography data-testid={`property-total-${totals.propertyId}`} sx={{ fontSize: { xs: '1.65rem', sm: '1.9rem' }, fontWeight: 700, letterSpacing: '-0.02em', mt: 1, ...TABULAR }}>
        {formatCurrency(total)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {remaining > 0.004
          ? <>reste <Box component="b" sx={{ color: 'warning.main', ...TABULAR }}>{formatCurrency(remaining)}</Box> à déclarer</>
          : (total > 0
            ? <Box component="span" sx={{ color: 'success.main', fontWeight: 600 }}>{TAX_PROPERTY.allDeclared}</Box>
            : TAX_PROPERTY.nothing)}
      </Typography>
      <Box role="img" aria-label={TAX_PROPERTY.progress} sx={{ display: 'flex', height: 8, borderRadius: 99, bgcolor: 'neutral.soft', my: 1.5, overflow: 'hidden' }}>
        <Box sx={{ width: `${pct}%`, bgcolor: 'primary.main', transition: 'width 400ms cubic-bezier(.2,.8,.2,1)', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }} />
        <Box sx={{ width: `${total > 0 ? 100 - pct : 0}%`, bgcolor: 'chart.upcoming', transition: 'width 400ms cubic-bezier(.2,.8,.2,1)', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }} />
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
        {[
          [totals.taxedPersonNights, TAX_PROPERTY.taxedNights],
          [totals.taxedPersons, TAX_PROPERTY.taxedPersons],
          [formatCurrency(declared), TAX_PROPERTY.alreadyDeclared],
        ].map(([value, label]) => (
          <Box key={label} sx={{ bgcolor: 'background.default', borderRadius: 2, px: 1.25, py: 1 }}>
            <Typography component="b" sx={{ display: 'block', fontSize: { xs: '0.95rem', sm: '1.05rem' }, fontWeight: 700, ...TABULAR }}>{value}</Typography>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
          </Box>
        ))}
      </Box>
      {hasPlatform && (
        <Typography variant="caption" sx={{ display: 'block', mt: 1.25, px: 1.125, py: 0.75, borderRadius: 2, color: 'info.main', bgcolor: 'info.soft' }}>
          {TAX_PROPERTY.platformNote(totals.platformRemittedStaysCount, formatCurrency(totals.platformRemittedAmount))}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5, flexDirection: { xs: 'column', sm: 'row' } }}>
        <Button variant="contained" disableElevation disabled={nothingLeft || busy} onClick={onDeclare} sx={{ minHeight: 44 }}>
          {TAX_PROPERTY.declare(name)}
        </Button>
        <Button variant="outlined" onClick={onExport} sx={{ minHeight: 44 }}>{TAX_PROPERTY.export(name)}</Button>
      </Box>
    </Box>
  );
}
