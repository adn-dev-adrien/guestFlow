/**
 * SeasonsClosuresPage — `/parametres/vacances-fermetures`
 *
 * Groups « Vacances scolaires » and « Fermetures » under one menu entry. The tabs are handed to the
 * active child, which passes them to its `PageActionBar`: centred in the bar on sm+, second row of
 * the same sticky block on xs (specs/ds-tabs.md rule 2). Only the active tab is mounted; standalone
 * routes (/school-holidays, /establishment-closures) are unaffected.
 */

import React, { useState } from 'react';
import { Box } from '@mui/material';
import PageTabs from '../components/PageTabs';
import SchoolHolidaysPage from './SchoolHolidaysPage';
import EstablishmentClosuresPage from './EstablishmentClosuresPage';
import { usePlugin } from '../hooks/usePlugins';
import { SCHOOL_HOLIDAYS } from '../constants/plugins';

const ITEMS = [
  { value: 'holidays', label: 'Vacances scolaires' },
  { value: 'closures', label: 'Fermetures' },
];

export default function SeasonsClosuresPage() {
  const [tab, setTab] = useState('holidays');
  // Without the school-holidays plugin only the closures remain, and a single tab is no tab
  // (specs/plugins-phase-0-foundation.md rule 16).
  const holidaysOn = usePlugin(SCHOOL_HOLIDAYS);
  if (!holidaysOn) return <Box><EstablishmentClosuresPage /></Box>;

  const barTabs = <PageTabs value={tab} onChange={setTab} items={ITEMS} ariaLabel="Vacances et fermetures" />;

  return (
    <Box>
      {tab === 'holidays'
        ? <SchoolHolidaysPage barTabs={barTabs} />
        : <EstablishmentClosuresPage barTabs={barTabs} />}
    </Box>
  );
}
