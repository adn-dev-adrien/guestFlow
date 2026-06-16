/**
 * BillableAmountsPage — `/parametres/tarifs`
 *
 * Dedicated page for the « Tarifs facturables » (prix du linge manquant + montants de réparation
 * facturés dans le SAS). The content is the self-contained `SettingsBillableAmountsSection`
 * (loads/saves its own data via /settings/linen-items + /settings/repair-amounts); this page just
 * gives it a route + a left-menu entry of its own (previously a section of Paramètres → Générale).
 */

import React from 'react';
import { Box } from '@mui/material';
import PageActionBar from '../components/PageActionBar';
import SettingsBillableAmountsSection from '../components/SettingsBillableAmountsSection';

export default function BillableAmountsPage() {
  return (
    <Box>
      <PageActionBar title="Tarifs facturables" backTo="/parametres" />
      <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: { xs: '100%', md: 900, lg: 1240 }, mx: 'auto' }}>
        <SettingsBillableAmountsSection />
      </Box>
    </Box>
  );
}
