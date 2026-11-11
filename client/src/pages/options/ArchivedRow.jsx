/**
 * ArchivedRow — an archived option in the folded « Archivées » section (specs/options-resources-ux.md
 * rules 26-27): its name and category, a note, and « Restaurer ».
 *
 * Props: item { id, title, category }, onRestore(item), busy
 */
import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { TEXTS } from '../../constants/optionsResourcesTexts';

export default function ArchivedRow({ item, onRestore, busy }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pl: { xs: 1.75, sm: 2.25 }, pr: 1, py: 1.25 }}>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 600, fontSize: '0.95rem', color: 'text.secondary', overflowWrap: 'anywhere' }}>{item.title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.84rem' }}>
          {[item.category, TEXTS.archivedNote].filter(Boolean).join(' · ')}
        </Typography>
      </Box>
      <Button
        onClick={() => onRestore(item)}
        disabled={busy}
        aria-label={`${TEXTS.restore} ${item.title}`}
        sx={{ minHeight: 44, flex: 'none' }}
      >
        {TEXTS.restore}
      </Button>
    </Box>
  );
}
