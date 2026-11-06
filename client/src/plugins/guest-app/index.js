// Application clients — client module (specs/guest-app.md §4.2).
import { lazy } from 'react';

export default {
  id: 'guest-app',
  contributes: {
    'settings.integrations': [{
      key: 'guest-app',
      order: 80,
      tabLabel: 'Application clients',
      keywords: ['Application clients', 'Mon séjour', 'Livret', 'QR'],
      Component: lazy(() => import('./SettingsGuestAppSection')),
    }],
    // specs/guest-app.md rule 9bis (a) — « Mon séjour » takes the SAS « Portail » step over while the SAS data says
    // this stay has a link; the gate key's own step becomes its « QR du portail seul ».
    'sas.portal': [{
      key: 'stay-app',
      order: 5,
      leadsStep: { title: 'Mon séjour' },
      Component: lazy(() => import('./SasStayAppStep')),
    }],
  },
};
