/**
 * DefinitionButton — the small « i » beside a figure's label that opens its definition
 * (specs/report-grammar.md rule 2). Non-modal: a click toggles it, a click outside or Escape closes it,
 * and Escape gives the focus back to the button. Generic: any label that needs a one-paragraph
 * definition (KPI tile, panel title, table header).
 *
 * Props:
 *   label:       string      what is defined — the button reads « Définition : <label> »
 *   definition:  ReactNode   the text, ready-made (server or constants)
 */
import React, { useId, useRef, useState } from 'react';
import { Box, ButtonBase, ClickAwayListener, Popper } from '@mui/material';
import { touchHitArea } from '../utils/touchHitArea';
import { chart } from '../utils/chartColors';

const POP_IN = {
  '@keyframes definitionPopIn': { from: { opacity: 0, transform: 'scale(.96) translateY(-4px)' }, to: { opacity: 1, transform: 'none' } },
  animation: 'definitionPopIn .18s cubic-bezier(.2,.8,.2,1)',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
};

// Rule 23 — the bubble takes the width of its text up to 280 px (never the 24 px of its anchor), and
// never more than the screen minus its margins.
export const BUBBLE_SX = {
  width: 'max-content', maxWidth: 'min(280px, calc(100vw - 32px))',
  bgcolor: chart.tooltip, color: '#fff', fontSize: '0.8rem', lineHeight: 1.45,
  px: 1.5, py: 1.25, borderRadius: '10px', boxShadow: '0 10px 24px -10px rgba(0,0,0,.4)',
  transformOrigin: 'top right', ...POP_IN,
};

export default function DefinitionButton({ label, definition }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const bubble = useRef(null);
  const id = useId();
  const close = () => setOpen(false);
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close();
      if (anchor.current) anchor.current.focus();
    }
  };
  // Rule 23 — moving the focus away (Tab) closes the bubble; a focus that stays on the button or
  // lands in the bubble keeps it.
  const onBlur = (e) => {
    const next = e.relatedTarget;
    if (!next || !(anchor.current?.contains(next) || bubble.current?.contains(next))) close();
  };
  return (
    <ClickAwayListener onClickAway={close}>
      <Box component="span" sx={{ display: 'inline-flex', flex: 'none' }} onKeyDown={onKeyDown}>
        <ButtonBase
          ref={anchor}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          onBlur={onBlur}
          aria-label={`Définition : ${label}`}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-describedby={open ? id : undefined}
          sx={{
            width: 24, height: 24, borderRadius: '50%', flex: 'none',
            bgcolor: 'neutral.soft', color: 'text.secondary',
            fontFamily: 'serif', fontStyle: 'italic', fontWeight: 600, fontSize: '0.75rem', lineHeight: 1,
            '&:active': { transform: 'scale(.94)' },
            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
            '@media (prefers-reduced-motion: reduce)': { '&:active': { transform: 'none' } },
            ...touchHitArea,
          }}
        >
          i
        </ButtonBase>
        {/* Rule 23 — in a portal, positioned « fixed »: a card that clips its overflow never cuts it. */}
        <Popper id={id} open={open} anchorEl={anchor.current} placement="bottom-end" popperOptions={{ strategy: 'fixed' }} sx={{ zIndex: 1500 }} modifiers={[{ name: 'offset', options: { offset: [0, 8] } }, { name: 'preventOverflow', options: { padding: 16 } }]}>
          <Box ref={bubble} data-testid="definition-bubble" sx={BUBBLE_SX}>
            {definition}
          </Box>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
