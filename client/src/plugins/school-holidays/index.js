// Vacances scolaires — client module (specs/plugins-phase-1-sdk.md §3.C).
import { lazy } from 'react';
import { ZONE_COLORS, ZONE_KEYS } from './zoneColors';

const SchoolHolidaysPage = lazy(() => import('./SchoolHolidaysPage'));

export default {
  id: 'school-holidays',
  contributes: {
    routes: [{ path: '/school-holidays', Component: SchoolHolidaysPage, roles: ['admin'] }],
    // The first tab of Paramètres › Vacances & fermetures; the closures tab stays core.
    'closures.tabs': [{ key: 'holidays', label: 'Vacances scolaires', order: 10, Component: SchoolHolidaysPage }],
    'calendar.dayMarkers': [{
      key: 'school-holidays',
      load: () => import('./markers').then((m) => m.load()),
      legend: ZONE_KEYS.map((z) => ({ key: `zone-${z}`, color: ZONE_COLORS[z], label: `Zone ${z}` })),
      legendCaption: 'vacances scolaires',
    }],
  },
};
