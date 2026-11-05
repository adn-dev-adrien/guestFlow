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
  },
};
