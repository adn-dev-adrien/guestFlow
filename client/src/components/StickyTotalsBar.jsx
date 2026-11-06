/**
 * StickyTotalsBar — several labelled totals pinned to the bottom of the screen while a long list scrolls under
 * them (specs/tourist-tax-report-v2.md rules 17-23). Generic: the tourist-tax report today; the accounting
 * synthesis and the payment register can reuse it. Renders the figures it is given, already formatted — never
 * computes one.
 *
 * A translucent, frosted surface (solid under `prefers-reduced-transparency`). Every figure has the same size
 * (specs/tourist-tax-report-v2.md rule 39, D-HC17): `main` is emphasised by colour only (and a divider before it),
 * never by size. Each label sits in a block exactly two lines high, aligned to its bottom and clamped to two lines
 * (the full label in its `title`, rule 45), so the figures of a row share one baseline whatever their labels; the
 * caption goes under the figure. From `sm` up every figure shows: on one line when they fit, else on two or more
 * rows, each row on its own baseline, never overlapping (each figure keeps at least the width of its own content —
 * rule 47, D-HC19). Only on a phone (`xs`) does the bar fold to the items flagged `compact`, with a toggle
 * (« Détail des totaux » / « Masquer le détail », `aria-expanded`) that unfolds the others above them, at the same
 * size. The figures are a polite live region: a change of selection or a tick is read out once.
 *
 * Props:
 *   items:       Array<{ key, label, value, caption?, main?, compact? }>   value / caption: strings or nodes
 *   label:       string     accessible name of the bar (« Totaux de la sélection »)
 *   moreLabel?:  string     phone toggle, folded (default « Détail des totaux »)
 *   lessLabel?:  string     phone toggle, unfolded (default « Masquer le détail »)
 *   sx?:         object
 */
import React, { useId, useState } from 'react';
import { Box, ButtonBase, Typography, useMediaQuery } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const FIGURE = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: '1.05rem', fontWeight: 700, lineHeight: 1.25 };
const LABEL_LINE = 1.4;
// Exactly two label lines: a short label sits at the bottom of the block, a longer one is clamped to two lines, so
// every figure of a row starts at the same height (rules 39, 45).
const LABEL_BLOCK = { display: 'flex', alignItems: 'flex-end', height: `calc(2 * ${LABEL_LINE} * 0.72rem)`, overflow: 'hidden' };
const LABEL_CLAMP = {
  display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden', lineHeight: LABEL_LINE,
  color: 'text.secondary',
};
// The width a figure asks for on a row (its label, figure and caption read without squeezing); the row wraps below it.
const FIGURE_BASIS = '6.25rem';

function Figure({ item, inRow = false }) {
  return (
    <Box
      data-testid={`total-${item.key}`}
      sx={{
        minWidth: inRow ? 'min-content' : 0,
        ...(inRow ? { flex: `1 1 ${FIGURE_BASIS}` } : {}),
        ...(inRow && item.main ? { textAlign: 'right', pl: 2, borderLeft: 1, borderColor: 'divider' } : {}),
      }}
    >
      <Box data-label-block="" sx={{ ...LABEL_BLOCK, ...(inRow && item.main ? { justifyContent: 'flex-end' } : {}) }}>
        <Typography variant="kpiLabel" component="span" title={typeof item.label === 'string' ? item.label : undefined} sx={LABEL_CLAMP}>
          {item.label}
        </Typography>
      </Box>
      <Typography component="span" data-figure="" sx={{ ...FIGURE, display: 'block', color: item.main ? 'primary.main' : 'text.primary' }}>
        {item.value}
      </Typography>
      <Typography variant="caption" component="span" sx={{ display: 'block', color: 'text.secondary', minHeight: '1.2em', lineHeight: 1.3 }}>
        {item.caption || '\u00a0'}
      </Typography>
    </Box>
  );
}

export default function StickyTotalsBar({ items = [], label, moreLabel = 'Détail des totaux', lessLabel = 'Masquer le détail', sx }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  // Rule 47 (D-HC19) — the fold is for the phone only; elsewhere the figures wrap into rows.
  const folded = phone;
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const compact = items.filter((i) => i.compact);
  const rest = items.filter((i) => !i.compact);

  return (
    <Box
      component="section"
      aria-label={label}
      data-testid="sticky-totals-bar"
      sx={{
        position: 'sticky',
        bottom: 0,
        zIndex: (t) => t.zIndex.appBar - 2,
        mt: 2,
        px: { xs: 1.5, sm: 2.25 },
        pt: 1.25,
        pb: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        border: 1,
        borderColor: 'divider',
        borderRadius: { xs: '14px 14px 0 0', sm: 1 },
        bgcolor: alpha(theme.palette.background.paper, 0.86),
        backdropFilter: 'blur(18px) saturate(170%)',
        WebkitBackdropFilter: 'blur(18px) saturate(170%)',
        boxShadow: '0 -6px 18px rgba(39,37,31,.06)',
        '@media (prefers-reduced-transparency: reduce)': { bgcolor: 'background.paper', backdropFilter: 'none', WebkitBackdropFilter: 'none' },
        ...sx,
      }}
    >
      {folded ? (
        <>
          {open && (
            <Box id={detailId} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25, pb: 1.25, mb: 1.25, borderBottom: 1, borderColor: 'divider' }}>
              {rest.map((item) => <Figure key={item.key} item={item} />)}
            </Box>
          )}
          <Box aria-live="polite" sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
            {compact.map((item) => <Figure key={item.key} item={item} />)}
          </Box>
          {rest.length > 0 && (
            <ButtonBase
              aria-expanded={open}
              aria-controls={open ? detailId : undefined}
              onClick={() => setOpen((o) => !o)}
              sx={{ mt: 0.5, minHeight: 44, width: '100%', justifyContent: 'center', gap: 0.5, borderRadius: 1, color: 'primary.main', fontWeight: 600, fontSize: '0.85rem' }}
            >
              {open ? lessLabel : moreLabel}
              {open ? <ExpandMoreIcon fontSize="small" aria-hidden /> : <ExpandLessIcon fontSize="small" aria-hidden />}
            </ButtonBase>
          )}
        </>
      ) : (
        <Box aria-live="polite" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: { sm: 1.5, lg: 2.5 }, rowGap: 1.25 }}>
          {items.map((item) => <Figure key={item.key} item={item} inRow />)}
        </Box>
      )}
    </Box>
  );
}
