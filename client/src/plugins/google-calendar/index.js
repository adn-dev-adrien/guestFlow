// Google Agenda — client module (specs/plugins-phase-1-sdk.md §3.C).
import { lazy } from 'react';

export default {
  id: 'google-calendar',
  contributes: {
    'settings.integrations': [
      { key: 'google', order: 10, tabLabel: 'Google Agenda', keywords: ['Google Agenda'], Component: lazy(() => import('./SettingsGoogleCalendarSection')) },
    ],
  },
};
