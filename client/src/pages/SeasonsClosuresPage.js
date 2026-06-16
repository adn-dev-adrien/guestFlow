/**
 * SeasonsClosuresPage — `/parametres/vacances-fermetures`
 *
 * Groups the two date-period admin views under one menu entry: « Vacances scolaires » (pricing-season
 * reference) and « Fermetures » (establishment unavailability). Each tab renders the existing,
 * self-contained page (with its own action bar + dialogs) — only the active tab is mounted.
 */

import React, { useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import SchoolHolidaysPage from './SchoolHolidaysPage';
import EstablishmentClosuresPage from './EstablishmentClosuresPage';

export default function SeasonsClosuresPage() {
  const [tab, setTab] = useState('holidays');
  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, next) => setTab(next)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ borderBottom: 1, borderColor: 'divider', px: { xs: 1, sm: 2 } }}
      >
        <Tab value="holidays" label="Vacances scolaires" />
        <Tab value="closures" label="Fermetures" />
      </Tabs>
      {tab === 'holidays' ? <SchoolHolidaysPage /> : <EstablishmentClosuresPage />}
    </Box>
  );
}
