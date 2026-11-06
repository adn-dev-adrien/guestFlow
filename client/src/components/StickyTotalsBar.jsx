/**
 * StickyTotalsBar — several labelled totals pinned to the bottom of the screen while a long list scrolls under
 * them (specs/tourist-tax-report-v2.md rules 17-23). Generic: the tourist-tax report today; the accounting
 * synthesis and the payment register can reuse it. Renders the figures it is given, already formatted — never
 * computes one.
 *
 * A translucent, frosted surface (solid under `prefers-reduced-transparency`). Every figure has the same size and all
 * figures sit on one line, on a common baseline (specs/tourist-tax-report-v2.md rule 39, D-HC17): each label sits in a
 * block two lines high, aligned to its bottom, so a label that wraps never pushes its figure down; the caption goes
 * under the figure. `main` is emphasised by colour only (and a divider before it), never by size. When the bar is too
 * narrow for one line — a phone, or a tablet beside the drawer — only the items flagged `compact` show, with a toggle
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
import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { Box, ButtonBase, Typography, useMediaQuery } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const FIGURE = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: '1.05rem', fontWeight: 700, lineHeight: 1.25 };
// Two label lines: a label that wraps fills the block, a short one sits at its bottom, figures share one baseline.
const LABEL_BLOCK = { display: 'flex', alignItems: 'flex-end', minHeight: 'calc(2 * 1.4 * 0.72rem)' };
// The width one figure needs on a line; below items × this, the bar folds like on a phone.
const FIGURE_MIN_WIDTH = 104;

function Figure({ item, inRow = false }) {
  return (
    <Box
      data-testid={`total-${item.key}`}
      sx={{
        minWidth: 0,
        ...(inRow ? { flex: item.main ? '0 0 auto' : '1 1 0' } : {}),
        ...(inRow && item.main ? { textAlign: 'right', pl: 2, borderLeft: 1, borderColor: 'divider' } : {}),
      }}
    >
      <Box sx={{ ...LABEL_BLOCK, ...(inRow && item.main ? { justifyContent: 'flex-end' } : {}) }}>
        <Typography variant="kpiLabel" component="span" sx={{ display: 'block', color: 'text.secondary' }}>{item.label}</Typography>
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

/** Whether the bar's own width holds every figure on one line; unknown (no ResizeObserver) reads as « yes ». */
function useFitsOneLine(ref, count) {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const judge = () => {
      const width = node.getBoundingClientRect().width;
      setFits(width === 0 || width >= count * FIGURE_MIN_WIDTH);
    };
    judge();
    const observer = new ResizeObserver(judge);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, count]);
  return fits;
}

export default function StickyTotalsBar({ items = [], label, moreLabel = 'Détail des totaux', lessLabel = 'Masquer le détail', sx }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const barRef = useRef(null);
  const fits = useFitsOneLine(barRef, items.length);
  const folded = phone || !fits;
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const compact = items.filter((i) => i.compact);
  const rest = items.filter((i) => !i.compact);

  return (
    <Box
      component="section"
      ref={barRef}
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
        <Box aria-live="polite" sx={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'flex-start', columnGap: { sm: 1.5, lg: 2.5 } }}>
          {items.map((item) => <Figure key={item.key} item={item} inRow />)}
        </Box>
      )}
    </Box>
  );
}
