/**
 * SeasonsClosuresPage — `/parametres/vacances-fermetures`
 *
 * Groups « Vacances scolaires » and « Fermetures » under one menu entry. Since the phase-3 sweep
 * (specs/ds-sweep-settings.md §3.2) the wrapper no longer stacks its own Tabs strip above the
 * child's sticky bar: the Tabs render CENTERED in the active child's PageActionBar on sm+, and as a
 * slim strip under the bar on xs. Only the active tab is mounted; standalone routes
 * (/school-holidays, /establishment-closures) are unaffected.
 */

import React, { useState } from 'react';
import { Box, Tabs, Tab, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SchoolHolidaysPage from './SchoolHolidaysPage';
import EstablishmentClosuresPage from './EstablishmentClosuresPage';

export default function SeasonsClosuresPage() {
  const [tab, setTab] = useState('holidays');
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
      <Tab value="holidays" label="Vacances scolaires" />
      <Tab value="closures" label="Fermetures" />
    </Tabs>
  );

  return (
    <Box>
      {isXs && (
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}>{tabs}</Box>
      )}
      {tab === 'holidays'
        ? <SchoolHolidaysPage barCenter={isXs ? undefined : tabs} />
        : <EstablishmentClosuresPage barCenter={isXs ? undefined : tabs} />}
    </Box>
  );
}
