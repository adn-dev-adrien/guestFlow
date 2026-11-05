/**
 * NoComparisonNotice — the one line that says why a report shows no comparison with last year
 * (specs/report-grammar.md rule 5): the tiles' pills read « — vs N-1 », this says why, once. The text
 * comes ready-made from the server (or the page's constants); without text nothing renders.
 *
 * Props:
 *   text?:  ReactNode   « Aucun séjour sur la même période de l'exercice précédent. »
 *   sx?:    object      extra layout (margins)
 */
import React from 'react';
import { Box } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

export default function NoComparisonNotice({ text, sx }) {
  if (!text) return null;
  return (
    <Box
      role="note"
      sx={{ display: 'flex', gap: 1, alignItems: 'center', fontSize: '0.86rem', bgcolor: 'info.soft', color: 'info.text', borderRadius: '10px', px: 1.5, py: 1.125, mt: 1.25, ...sx }}
    >
      <InfoOutlinedIcon fontSize="small" aria-hidden="true" sx={{ flex: 'none' }} />
      <Box component="span" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{text}</Box>
    </Box>
  );
}
