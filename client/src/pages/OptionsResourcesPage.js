/**
 * OptionsResourcesPage — `/parametres/options-ressources`
 *
 * Groups the « Options » and « Ressources » catalogs under one menu entry. Each tab renders the
 * existing, self-contained page — only the active tab is mounted.
 */

import React, { useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import OptionsPage from './OptionsPage';
import ResourcesPage from './ResourcesPage';

export default function OptionsResourcesPage() {
  const [tab, setTab] = useState('options');
  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, next) => setTab(next)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: 'divider', px: { xs: 1, sm: 2 } }}
      >
        <Tab value="options" label="Options" />
        <Tab value="resources" label="Ressources" />
      </Tabs>
      {tab === 'options' ? <OptionsPage /> : <ResourcesPage />}
    </Box>
  );
}
