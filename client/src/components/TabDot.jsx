/**
 * TabDot — the small dot a tab carries after its label (`PageTabs` item `badge`, specs/ds-tabs.md
 * rule 8): a property tab that is modified or refused, an Intégrations tab that is modified, refused
 * or still to set up (specs/integrations-tab-per-plugin.md rules 10–11).
 *
 * Props:
 *   color  'error' | 'warning' | 'primary'  palette colour of the dot
 *   label  string                           what the dot says to a screen reader (French)
 */
import React from 'react';
import { Box } from '@mui/material';

export default function TabDot({ color, label }) {
  return (
    <Box
      component="span"
      role="img"
      aria-label={label}
      title={label}
      sx={{ width: 8, height: 8, borderRadius: '50%', ml: 0.75, flex: 'none', bgcolor: `${color}.main` }}
    />
  );
}
