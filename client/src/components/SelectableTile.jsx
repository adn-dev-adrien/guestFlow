/**
 * SelectableTile — a KPI tile that opens its detail: label, figure, caption, a colour dot, and a
 * pressed state with a pointer toward the panel it opened (specs/finance-dashboard-redesign.md
 * rule 13). Generic: any « figure → its table » dashboard.
 *
 * Props:
 *   label:        string
 *   value:        ReactNode      the figure (already formatted)
 *   caption?:     ReactNode
 *   dotColor?:    string         MUI palette path or CSS colour
 *   valueColor?:  string         e.g. 'error.main' for an amount that needs attention
 *   selected:     boolean
 *   onClick:      () => void
 *   controls?:    string         id of the panel it opens (aria-controls)
 */
import React from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';

export default function SelectableTile({ label, value, caption, dotColor, valueColor, selected, onClick, controls }) {
  return (
    <ButtonBase
      onClick={onClick}
      aria-expanded={selected}
      aria-controls={controls}
      aria-label={`${label} : ${selected ? 'masquer' : 'afficher'} le détail`}
      sx={{
        position: 'relative', display: 'block', width: '100%', height: '100%', textAlign: 'left', minHeight: 44,
        bgcolor: 'background.paper', borderRadius: 3.5, px: 1.75, py: 1.5,
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
