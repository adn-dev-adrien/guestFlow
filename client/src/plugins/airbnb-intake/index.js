// Saisie Airbnb — client module (specs/airbnb-mail-intake.md §4.3).
import { lazy } from 'react';

export default {
  id: 'airbnb-intake',
  contributes: {
    'reservation.banners': [{ key: 'airbnb-intake', order: 30, Component: lazy(() => import('./IntakeBanner')) }],
    'dashboard.alerts': [{ key: 'airbnb-intake', order: 40, Component: lazy(() => import('./IntakeAlert')) }],
    'settings.integrations': [{ key: 'airbnb-intake', order: 60, Component: lazy(() => import('./SettingsSection')) }],
  },
};
