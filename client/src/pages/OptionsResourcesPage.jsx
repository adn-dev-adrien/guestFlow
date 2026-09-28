/**
 * OptionsResourcesPage — `/parametres/options-ressources`
 *
 * Groups the « Options », « Ressources » and « Facturables au SAS » catalogs under one menu entry
 * (specs/settings-rationalization.md rule 2 — the former « Tarifs facturables » entry is the third
 * tab). The tabs are handed to the active child, which passes them to its `PageActionBar`: centred
 * in the bar on sm+, second row of the same sticky block on xs (specs/ds-tabs.md rule 2). The tab
 * lives in `?tab=` so the old `/parametres/tarifs` link lands on it. Only the active tab is mounted;
 * standalone routes (/options, /resources) are unaffected (no barTabs).
 */

import React from 'react';
import { useSearchParams } from 'react-router';
import { Box } from '@mui/material';
import PageTabs from '../components/PageTabs';
import OptionsPage from './OptionsPage';
import ResourcesPage from './ResourcesPage';
import BillableAmountsPage from './BillableAmountsPage';
import { usePlugin } from '../hooks/usePlugins';
import { SAS } from '../constants/plugins';

const ITEMS = [
  { value: 'options', label: 'Options' },
  { value: 'resources', label: 'Ressources' },
  { value: 'sas', label: 'Facturables au SAS' },
];

export default function OptionsResourcesPage() {
  const [params, setParams] = useSearchParams();
  // « Facturables au SAS » belongs to the SAS plugin (specs/plugins-phase-0-foundation.md rule 16).
  const sasOn = usePlugin(SAS);
  const items = sasOn ? ITEMS : ITEMS.filter((i) => i.value !== 'sas');
  const tab = items.some((i) => i.value === params.get('tab')) ? params.get('tab') : 'options';

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
      {tab === 'sas' && <BillableAmountsPage barTabs={barTabs} />}
    </Box>
  );
}
