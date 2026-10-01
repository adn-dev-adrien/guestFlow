/**
 * OptionsResourcesPage — `/parametres/options-ressources`
 *
 * Groups the « Options » and « Ressources » catalogs under one menu entry, plus the tabs plugins
 * contribute through the `optionsResources.tabs` slot (`{ key, value, label, order, Component }`) —
 * the SAS plugin's « Facturables au SAS » (specs/settings-rationalization.md rule 2,
 * specs/plugins-phase-2-hosts.md rule 8). The tabs are handed to the active child, which passes them
 * to its `PageActionBar`: centred in the bar on sm+, second row of the same sticky block on xs
 * (specs/ds-tabs.md rule 2). The tab lives in `?tab=` so the old `/parametres/tarifs` link lands on
 * it. Only the active tab is mounted; standalone routes (/options, /resources) are unaffected (no
 * barTabs).
 */

import React, { Suspense } from 'react';
import { useSearchParams } from 'react-router';
import { Box } from '@mui/material';
import PageTabs from '../components/PageTabs';
import OptionsPage from './OptionsPage';
import ResourcesPage from './ResourcesPage';
import { useSlot } from '../plugins/sdk/useSlot';

const CORE_ITEMS = [
  { value: 'options', label: 'Options' },
  { value: 'resources', label: 'Ressources' },
];

export default function OptionsResourcesPage() {
  const [params, setParams] = useSearchParams();
  const contributed = useSlot('optionsResources.tabs');
  const items = [...CORE_ITEMS, ...contributed.map(({ value, label }) => ({ value, label }))];
  const tab = items.some((i) => i.value === params.get('tab')) ? params.get('tab') : 'options';
  const Contributed = contributed.find((c) => c.value === tab)?.Component;

  const barTabs = (
    <PageTabs
      value={tab}
      onChange={(next) => setParams(next === 'options' ? {} : { tab: next }, { replace: true })}
      items={items}
      ariaLabel="Options et ressources"
    />
  );

  return (
    <Box>
      {tab === 'options' && <OptionsPage barTabs={barTabs} />}
      {tab === 'resources' && <ResourcesPage barTabs={barTabs} />}
      {Contributed && <Suspense fallback={null}><Contributed barTabs={barTabs} /></Suspense>}
    </Box>
  );
}
