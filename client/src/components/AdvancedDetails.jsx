/**
 * AdvancedDetails — a folded « Avancé » block (specs/plugins-phase-p-productisation.md rule 41): the
 * technical names a setting cannot do without (a protocol, a portal menu, a header) stay out of the
 * main text and open on demand. Closed at first.
 *
 * Props:
 *   label         string — the toggle's text, default « Avancé »
 *   defaultOpen   boolean — open at first, default false
 *   children      the folded content
 *   sx            outer Box sx
 */
import React, { useId, useState } from 'react';
import { Box, Button, Collapse } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

export default function AdvancedDetails({ label = 'Avancé', defaultOpen = false, children, sx }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <Box sx={sx}>
      <Button
        variant="text"
        color="inherit"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        endIcon={<ExpandMoreIcon sx={{ transition: 'transform 150ms ease-out', transform: open ? 'rotate(180deg)' : 'none' }} />}
        sx={{ minHeight: 44, px: 1, ml: -1, color: 'text.secondary', '@media (prefers-reduced-motion: reduce)': { '& svg': { transition: 'none' } } }}
      >
        {label}
      </Button>
      <Collapse in={open} id={id}>
        <Box sx={{ pt: 1 }}>{children}</Box>
      </Collapse>
    </Box>
  );
}
