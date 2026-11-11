// Saisie Gîtes de France — client module (specs/gites-de-france-mail-intake.md §4.3).
import { lazy } from 'react';

export default {
  id: 'gites-de-france-intake',
  contributes: {
    'reservation.banners': [{ key: 'gdf-intake', order: 10, Component: lazy(() => import('./IntakeBanner')) }],
    'dashboard.alerts': [{ key: 'gdf-intake', order: 20, Component: lazy(() => import('./IntakeAlert')) }],
    'settings.integrations': [{ key: 'gdf-intake', order: 40, tabLabel: 'Gîtes de France', keywords: ['Gîtes de France', 'ITEA'], Component: lazy(() => import('./SettingsSection')) }],
  },
};
