/**
 * OptionsResourcesPage — `/parametres/options-ressources`
 *
 * Groups the « Options » and « Ressources » catalogs under one menu entry. Since the phase-3 sweep
 * (specs/ds-sweep-settings.md §3.2) the wrapper no longer stacks its own Tabs strip above the
 * child's sticky bar: the Tabs render CENTERED in the active child's PageActionBar on sm+, and as a
 * slim strip under the bar on xs (the bar's center slot is hidden there). Only the active tab is
 * mounted; standalone routes (/options, /resources) are unaffected (no barCenter).
 */

import React, { useState } from 'react';
import { Box, Tabs, Tab, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import OptionsPage from './OptionsPage';
import ResourcesPage from './ResourcesPage';

export default function OptionsResourcesPage() {
  const [tab, setTab] = useState('options');
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));

  const tabs = (
    <Tabs
      value={tab}
      onChange={(_, next) => setTab(next)}
      variant="scrollable"
      allowScrollButtonsMobile
      sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40 } }}
    >
      <Tab value="options" label="Options" />
      <Tab value="resources" label="Ressources" />
    </Tabs>
  );

  return (
    <Box>
      {isXs && (
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}>{tabs}</Box>
      )}
      {tab === 'options'
        ? <OptionsPage barCenter={isXs ? undefined : tabs} />
        : <ResourcesPage barCenter={isXs ? undefined : tabs} />}
    </Box>
  );
}
