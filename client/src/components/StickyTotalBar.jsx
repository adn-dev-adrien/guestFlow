/**
 * StickyTotalBar — a total pinned to the bottom of the screen on narrow layouts, opening the full
 * detail in a bottom sheet (specs/ui-review-2026-10-19-operations.md rule 11).
 *
 * Renders a ready-made figure — never computes one. Shown only below `showBelow`; from there up the
 * page is expected to keep its detail in view by itself (a sticky side column). The figure
 * cross-fades when it changes so an edit elsewhere on the page visibly lands here; with reduced
 * motion it swaps at once. On a phone the bar steps aside while a text field has focus (the keyboard
 * is up). Placed as the LAST child of the page: being sticky, it keeps its own height in the flow, so
 * the last field above it is never covered.
 *
 * Props:
 *   label        string             the figure's name (« Vous percevez », « Total du séjour »)
 *   amount       number             the figure, already computed by the server
 *   secondary?   { label, amount } | null   a second figure, right-aligned
 *   sheetTitle   string             accessible name of the sheet (« Résumé tarifaire »)
 *   children     ReactNode          the sheet's content (the full detail)
 *   showBelow?   'sm' | 'md' | 'lg' | 'xl'   breakpoint under which the bar exists (default 'lg')
 *   bleed?       { x, bottom }      theme spacing (responsive objects allowed) the bar extends past its
 *                                    container — the page padding — so it sits flush with the screen
 *                                    edges and the bottom, even scrolled to the end
 */
import React, { useEffect, useState } from 'react';
import { Box, Typography, SwipeableDrawer, useMediaQuery } from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { formatCurrency } from '../utils/formatters';

const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), textarea, [contenteditable="true"]';
const AMOUNT = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

// The keyboard is up when a text field has focus — only worth knowing on a phone.
function useTyping(enabled) {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    const onIn = (e) => setTyping(Boolean(e.target?.matches?.(TYPING)));
    const onOut = () => setTyping(false);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, [enabled]);
  return enabled && typing;
}

const negate = (v) => (typeof v === 'object' && v !== null
  ? Object.fromEntries(Object.entries(v).map(([k, n]) => [k, -n]))
  : -(v || 0));

export default function StickyTotalBar({ label, amount, secondary = null, sheetTitle, children, showBelow = 'lg', bleed = null }) {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down(showBelow));
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const typing = useTyping(narrow && phone);
  const [open, setOpen] = useState(false);

  if (!narrow || amount == null) return null;

  return (
    <>
      <Box
        component="button"
        type="button"
        data-testid="sticky-total-bar"
        aria-label={`${label} ${formatCurrency(amount)}${secondary ? `, ${secondary.label} ${formatCurrency(secondary.amount)}` : ''} — ouvrir le ${String(sheetTitle).toLowerCase()}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        sx={{
          position: 'sticky',
          bottom: 0,
          zIndex: (t) => t.zIndex.appBar - 2,
          width: '100%',
          mt: 2,
          // Content-box: 100 % of the page's width plus the bleed on each side, pulled back by the margins.
          ...(bleed ? { boxSizing: 'content-box', mx: negate(bleed.x), mb: negate(bleed.bottom), px: bleed.x } : {}),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          ...(bleed ? {} : { px: 2 }),
          pt: 1.25,
          pb: 'calc(10px + env(safe-area-inset-bottom, 0px))',
          border: 0,
          borderTop: '1px solid',
          borderColor: 'divider',
          // A light frosted surface: the form scrolls underneath without losing the figure's contrast.
          bgcolor: alpha(theme.palette.background.paper, 0.88),
          backdropFilter: 'blur(18px) saturate(170%)',
          WebkitBackdropFilter: 'blur(18px) saturate(170%)',
          color: 'text.primary',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
          transition: 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 160ms ease-out',
          transform: typing ? 'translateY(110%)' : 'none',
          opacity: typing ? 0 : 1,
          pointerEvents: typing ? 'none' : 'auto',
          '&:active': { bgcolor: alpha(theme.palette.background.paper, 0.96) },
          '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          '@media (prefers-reduced-transparency: reduce)': { bgcolor: 'background.paper', backdropFilter: 'none' },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>{label}</Typography>
          <Typography
            key={amount}
            component="span"
            sx={{
              ...AMOUNT,
              display: 'block',
              fontWeight: 700,
              fontSize: '1.2rem',
              lineHeight: 1.25,
              animation: 'stickyTotalFade 240ms ease-out',
              '@keyframes stickyTotalFade': { from: { opacity: 0.2 }, to: { opacity: 1 } },
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          >
            {formatCurrency(amount)}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          {secondary && (
            <Box sx={{ textAlign: 'right', minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>{secondary.label}</Typography>
              <Typography variant="body2" component="span" sx={{ ...AMOUNT, display: 'block', fontWeight: 600 }}>
                {formatCurrency(secondary.amount)}
              </Typography>
            </Box>
          )}
          <ExpandLessIcon sx={{ color: 'text.secondary' }} aria-hidden />
        </Box>
      </Box>

      <SwipeableDrawer
        anchor="bottom"
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        disableSwipeToOpen
        disableDiscovery
        // Mounted only while open: the page already shows the same detail in its flow.
        ModalProps={{ keepMounted: false }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': sheetTitle,
            sx: {
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              maxHeight: '88vh',
              pb: 'env(safe-area-inset-bottom, 0px)',
              overscrollBehavior: 'contain',
            },
          },
        }}
      >
        <Box
          component="button"
          type="button"
          aria-label={`Fermer le ${String(sheetTitle).toLowerCase()}`}
          onClick={() => setOpen(false)}
          sx={{
            display: 'block', mx: 'auto', my: 1, width: 64, height: 24, border: 0, bgcolor: 'transparent', cursor: 'grab',
            position: 'relative',
            '&::after': {
              content: '""', position: 'absolute', left: 10, right: 10, top: 9, height: 5, borderRadius: 3,
              bgcolor: 'divider',
            },
          }}
        />
        <Box sx={{ px: 1.5, pb: 2, overflowY: 'auto', overscrollBehavior: 'contain' }}>
          {children}
        </Box>
      </SwipeableDrawer>
    </>
  );
}
