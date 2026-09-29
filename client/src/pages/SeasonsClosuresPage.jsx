/**
 * SeasonsClosuresPage — `/parametres/vacances-fermetures`
 *
 * Groups « Vacances scolaires » and « Fermetures » under one menu entry. The tabs are handed to the
 * active child, which passes them to its `PageActionBar`: centred in the bar on sm+, second row of
 * the same sticky block on xs (specs/ds-tabs.md rule 2). Only the active tab is mounted; standalone
 * routes (/school-holidays, /establishment-closures) are unaffected.
 *
 * « Fermetures » is core; the tabs before it come from plugin modules (slot `closures.tabs`,
 * specs/plugins-phase-1-sdk.md rule 13) — the school holidays. Without one, a single tab is no tab
 * (specs/plugins-phase-0-foundation.md rule 16).
 */

import React, { Suspense, useState } from 'react';
import { Box } from '@mui/material';
import PageTabs from '../components/PageTabs';
import EstablishmentClosuresPage from './EstablishmentClosuresPage';
import { useSlot } from '../plugins/sdk/useSlot';

const CLOSURES = { value: 'closures', label: 'Fermetures' };

export default function SeasonsClosuresPage() {
  const pluginTabs = useSlot('closures.tabs');
  const [tab, setTab] = useState(null);
  if (pluginTabs.length === 0) return <Box><EstablishmentClosuresPage /></Box>;

  const items = [...pluginTabs.map((t) => ({ value: t.key, label: t.label })), CLOSURES];
  const current = items.some((i) => i.value === tab) ? tab : items[0].value;
  const barTabs = <PageTabs value={current} onChange={setTab} items={items} ariaLabel="Vacances et fermetures" />;
  const pluginTab = pluginTabs.find((t) => t.key === current);

  return (
    <Box>
      {pluginTab
        ? <Suspense fallback={null}><pluginTab.Component barTabs={barTabs} /></Suspense>
        : <EstablishmentClosuresPage barTabs={barTabs} />}
    </Box>
  );
}
