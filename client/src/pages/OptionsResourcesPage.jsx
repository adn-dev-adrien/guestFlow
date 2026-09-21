/**
 * OptionsResourcesPage — `/parametres/options-ressources`
 *
 * Groups the « Options », « Ressources » and « Facturables au SAS » catalogs under one menu entry
 * (specs/settings-rationalization.md rule 2 — the former « Tarifs facturables » entry is the third
 * tab). The Tabs render CENTERED in the active child's PageActionBar on sm+, and as a slim strip
 * under the bar on xs (the bar's center slot is hidden there). The tab lives in `?tab=` so the old
 * `/parametres/tarifs` link lands on it. Only the active tab is mounted; standalone routes
 * (/options, /resources) are unaffected (no barCenter).
 */

import React from 'react';
import { useSearchParams } from 'react-router';
import { Box, Tabs, Tab, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import OptionsPage from './OptionsPage';
import ResourcesPage from './ResourcesPage';
import BillableAmountsPage from './BillableAmountsPage';

const TABS = ['options', 'resources', 'sas'];

export default function OptionsResourcesPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'options';
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));

  const tabs = (
    <Tabs
      value={tab}
      onChange={(_, next) => setParams(next === 'options' ? {} : { tab: next }, { replace: true })}
      variant="scrollable"
      allowScrollButtonsMobile
      sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40 } }}
    >
      <Tab value="options" label="Options" />
      <Tab value="resources" label="Ressources" />
      <Tab value="sas" label="Facturables au SAS" />
    </Tabs>
  );

  const barCenter = isXs ? undefined : tabs;
  return (
    <Box>
      {isXs && (
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 1 }}>{tabs}</Box>
      )}
      {tab === 'options' && <OptionsPage barCenter={barCenter} />}
      {tab === 'resources' && <ResourcesPage barCenter={barCenter} />}
      {tab === 'sas' && <BillableAmountsPage barCenter={barCenter} />}
    </Box>
  );
}
