/**
 * SelectableTile — a KPI tile that opens its detail: label, figure, caption, a colour dot, and a
 * pressed state with a pointer toward the panel it opened (specs/finance-dashboard-redesign.md
 * rule 13). Generic: any « figure → its table » dashboard.
 *
 * Report anatomy (specs/report-grammar.md rules 2–4), all optional: a « i » definition beside the
 * label, the caption as the secondary line (« TTC : 20 295 € »), and a year-over-year pill. Without
 * `onClick` the tile is a static figure (a `<div>`, not a button) — the KPI row of a report.
 *
 * Props:
 *   label:        string
 *   value:        ReactNode      the figure (already formatted)
 *   caption?:     ReactNode      the secondary line
 *   dotColor?:    string         MUI palette path or CSS colour
 *   valueColor?:  string         e.g. 'error.main' for an amount that needs attention
 *   selected:     boolean
 *   onClick?:     () => void     omitted → static tile
 *   controls?:    string         id of the panel it opens (aria-controls)
 *   info?:        ReactNode      the figure's definition, opened by the « i » button
 *   comparison?:  { change: number|null, previous?: string, unit?: 'percent'|'points', better?: 'higher'|'lower' }
 *                 the pill under the figure (YearOverYearBadge report mode); change null → « — vs N-1 »
 */
import React from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import DefinitionButton from './DefinitionButton';
import YearOverYearBadge from './YearOverYearBadge';

const STATIC_SX = {
  position: 'relative', display: 'block', width: '100%', height: '100%', textAlign: 'left', minHeight: 44, minWidth: 0,
  bgcolor: 'background.paper', borderRadius: 1, px: 2, py: 1.5,
  boxShadow: '0 3px 16px rgba(60,54,36,0.09)',
};

function Body({ label, value, caption, valueColor, comparison, labelEnd }) {
  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.75, minHeight: 24 }}>
        <Typography variant="kpiLabel" sx={{ color: 'text.secondary', minWidth: 0, overflowWrap: 'anywhere' }}>{label}</Typography>
        {labelEnd}
      </Box>
      <Typography sx={{ fontWeight: 700, fontSize: { xs: '1.18rem', sm: '1.3rem' }, lineHeight: 1.25, my: 0.25, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: valueColor }}>{value}</Typography>
      {caption && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontVariantNumeric: 'tabular-nums', mb: comparison ? 0.75 : 0 }}>{caption}</Typography>}
      {comparison && (
        <Box sx={{ mt: caption ? 0 : 0.5 }}>
          <YearOverYearBadge change={comparison.change} previous={comparison.previous} unit={comparison.unit} better={comparison.better} showEmpty />
        </Box>
      )}
    </>
  );
}

export default function SelectableTile({ label, value, caption, dotColor, valueColor, selected, onClick, controls, info, comparison }) {
  const definition = info ? <DefinitionButton label={label} definition={info} /> : null;
  if (!onClick) {
    return (
      <Box sx={STATIC_SX} data-testid="kpi-tile">
        {dotColor && !info && <Box component="span" sx={{ position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor }} />}
        <Body label={label} value={value} caption={caption} valueColor={valueColor} comparison={comparison} labelEnd={definition} />
      </Box>
    );
  }
  if (!info && !comparison) {
    return (
      <ButtonBase
        onClick={onClick}
        aria-expanded={selected}
        aria-controls={controls}
        aria-label={`${label} : ${selected ? 'masquer' : 'afficher'} le détail`}
        sx={{
          position: 'relative', display: 'block', width: '100%', height: '100%', textAlign: 'left', minHeight: 44,
          bgcolor: 'background.paper', borderRadius: 1, px: 2, py: 1.5,
          border: '1.5px solid', borderColor: selected ? 'primary.main' : 'transparent',
          boxShadow: '0 3px 16px rgba(60,54,36,0.09)', transition: 'border-color .15s, transform .1s',
          '&:hover': { transform: 'translateY(-2px)' },
          '&::after': selected ? {
            content: '""', position: 'absolute', left: '50%', bottom: -9, width: 14, height: 14,
            bgcolor: 'background.paper', borderRight: '1.5px solid', borderBottom: '1.5px solid', borderColor: 'primary.main',
            transform: 'translateX(-50%) rotate(45deg)', display: { xs: 'none', sm: 'block' },
          } : undefined,
        }}
      >
        {dotColor && <Box component="span" sx={{ position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor }} />}
        <Typography variant="kpiLabel" sx={{ color: 'text.secondary' }}>{label}</Typography>
        <Typography sx={{ fontWeight: 700, fontSize: '1.3rem', lineHeight: 1.25, my: 0.25, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: valueColor }}>{value}</Typography>
        {caption && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{caption}</Typography>}
      </ButtonBase>
    );
  }
  // A selectable tile with a definition: the « i » is a sibling of the tile's button, never nested
  // inside it (a button inside a button is invalid and unreachable by keyboard).
  return (
    <Box sx={{ position: 'relative', height: '100%' }}>
      <ButtonBase
        onClick={onClick}
        aria-expanded={selected}
        aria-controls={controls}
        aria-label={`${label} : ${selected ? 'masquer' : 'afficher'} le détail`}
        sx={{
          ...STATIC_SX,
          border: '1.5px solid', borderColor: selected ? 'primary.main' : 'transparent',
          transition: 'border-color .15s, transform .1s',
          '&:hover': { transform: 'translateY(-2px)' },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
        }}
      >
        <Body label={label} value={value} caption={caption} valueColor={valueColor} comparison={comparison} labelEnd={info ? <Box component="span" sx={{ width: 24, flex: 'none' }} /> : null} />
      </ButtonBase>
      {info && <Box sx={{ position: 'absolute', top: 12, right: 14 }}>{definition}</Box>}
    </Box>
  );
}
