/**
 * ChoiceCardStrip — a horizontally scrollable row of selectable cards, one of them selected: a filter
 * that also shows a figure per option (specs/finance-dashboard-redesign.md rule 12 — the logements
 * strip). Generic: any « pick one of N, each with its number » filter.
 *
 * Props:
 *   items:     Array<{ value, label, figure, caption?, color? }>   `value` null/'' = « all »
 *   selected:  the selected item's value
 *   onSelect:  (value) => void
 *   ariaLabel: string
 */
import React from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';

export default function ChoiceCardStrip({ items, selected, onSelect, ariaLabel }) {
  return (
    <Box role="radiogroup" aria-label={ariaLabel} sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 0.75, mb: 1.5, px: 0.25, pt: 0.25 }}>
      {items.map((item) => {
        const on = (selected ?? '') === (item.value ?? '');
        return (
          <ButtonBase
            key={item.value ?? 'all'}
            role="radio"
            aria-checked={on}
            onClick={() => onSelect(item.value ?? null)}
            sx={{
              flex: '0 0 auto', minWidth: 172, minHeight: 44, display: 'block', textAlign: 'left',
              bgcolor: on ? 'rgba(47,93,70,0.06)' : 'background.paper', borderRadius: '10px', px: 1.5, py: 1.25,
              border: '1.5px solid', borderColor: on ? 'primary.main' : 'transparent',
              boxShadow: '0 2px 10px rgba(60,54,36,0.07)', transition: 'border-color .15s, transform .1s',
              '&:hover': { transform: 'translateY(-1px)' },
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {item.color && <Box component="span" sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: item.color }} />}
              {item.label}
            </Typography>
            <Typography sx={{ fontWeight: 700, fontSize: '1.05rem', fontVariantNumeric: 'tabular-nums' }}>{item.figure}</Typography>
            {item.caption && <Typography variant="caption" color="text.secondary">{item.caption}</Typography>}
          </ButtonBase>
        );
      })}
    </Box>
  );
}
