/**
 * DefinitionButton — the small « i » beside a figure's label that opens its definition
 * (specs/report-grammar.md rule 2). Non-modal: a click toggles it, a click outside or Escape closes it,
 * and Escape gives the focus back to the button. Generic: any label that needs a one-paragraph
 * definition (KPI tile, panel title, table header).
 *
 * Props:
 *   label:       string      what is defined — the button reads « Définition : <label> »
 *   definition:  ReactNode   the text, ready-made (server or constants)
 *   onDark?:     boolean     light variant for a dark surface
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

export default function DefinitionButton({ label, definition, onDark = false }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const id = useId();
  const close = () => setOpen(false);
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close();
      if (anchor.current) anchor.current.focus();
    }
  };
  return (
    <ClickAwayListener onClickAway={close}>
      <Box component="span" sx={{ display: 'inline-flex', flex: 'none' }} onKeyDown={onKeyDown}>
        <ButtonBase
          ref={anchor}
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          aria-label={`Définition : ${label}`}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          sx={{
            width: 24, height: 24, borderRadius: '50%', flex: 'none',
            bgcolor: onDark ? 'rgba(255,255,255,0.16)' : 'neutral.soft', color: onDark ? '#fff' : 'text.secondary',
            fontFamily: 'serif', fontStyle: 'italic', fontWeight: 600, fontSize: '0.75rem', lineHeight: 1,
            '&:active': { transform: 'scale(.94)' },
            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
            '@media (prefers-reduced-motion: reduce)': { '&:active': { transform: 'none' } },
            ...touchHitArea,
          }}
        >
          i
        </ButtonBase>
        <Popper id={id} open={open} anchorEl={anchor.current} placement="bottom-end" disablePortal sx={{ zIndex: 5 }} modifiers={[{ name: 'offset', options: { offset: [0, 8] } }]}>
          <Box
            sx={{
              maxWidth: 280, bgcolor: chart.tooltip, color: '#fff', fontSize: '0.8rem', lineHeight: 1.45,
              px: 1.5, py: 1.25, borderRadius: '10px', boxShadow: '0 10px 24px -10px rgba(0,0,0,.4)',
              transformOrigin: 'top right', ...POP_IN,
            }}
          >
            {definition}
          </Box>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
