// Google Vacation Rentals — client module (specs/google-vacation-rentals-feed.md §4.2).
import { lazy } from 'react';

export default {
  id: 'google-vacation-rentals',
  contributes: {
    'settings.integrations': [{
      key: 'google-vacation-rentals',
      order: 70,
      tabLabel: 'Google Vacation Rentals',
      keywords: ['Google Vacation Rentals', 'Hotel Center', 'Locations de vacances'],
      Component: lazy(() => import('./SettingsGoogleVrSection')),
    }],
  },
};
