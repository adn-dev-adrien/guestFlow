// Saisie Booking — client module (specs/booking-extranet-intake.md §4.3).
import { lazy } from 'react';

export default {
  id: 'booking-intake',
  contributes: {
    'reservation.banners': [{ key: 'booking-intake', order: 20, Component: lazy(() => import('./IntakeBanner')) }],
    'dashboard.alerts.urgent': [{ key: 'booking-intake-urgent', order: 20, Component: lazy(() => import('./UrgentPendingAlert')) }],
    'dashboard.alerts': [{ key: 'booking-intake', order: 30, Component: lazy(() => import('./PendingAlert')) }],
    'settings.integrations': [{ key: 'booking-intake', order: 50, Component: lazy(() => import('./SettingsSection')) }],
  },
};
