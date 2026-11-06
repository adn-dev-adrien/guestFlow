/**
 * Panel — the white card of a report, titled by a small uppercase tracked label
 * (specs/report-grammar.md rule 7; the `panelLabel` typography role). Two per row on desktop, one on a
 * phone: the page's grid decides, the panel only fills its cell. Generic: any report block (chart,
 * share table, register).
 *
 * Props:
 *   label?:          string      the panel's title (« Encaissements cumulés par exercice »)
 *   action?:         ReactNode   right of the title (a toggle, a link)
 *   labelComponent?: string      the title's element, default 'h3' (the page title is h1, sections h2)
 *   children:        ReactNode
 *   sx?:             object
 */
import React, { useId } from 'react';
import { Box, Typography } from '@mui/material';

export default function Panel({ label, action, labelComponent = 'h3', children, sx }) {
  const id = useId();
  return (
    <Box
      component="section"
      aria-labelledby={label ? id : undefined}
      sx={{
        bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1,
        px: { xs: 1.5, sm: 2.25 }, py: { xs: 1.5, sm: 2 }, minWidth: 0,
        boxShadow: '0 1px 2px rgba(39,37,31,.04)', ...sx,
      }}
    >
      {(label || action) && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1.25, minHeight: 24 }}>
          {label && <Typography id={id} variant="panelLabel" component={labelComponent} sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere' }}>{label}</Typography>}
          {action}
        </Box>
      )}
      {children}
    </Box>
  );
}
