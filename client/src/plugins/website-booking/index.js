// Réservation depuis le site (WordPress) — client module (specs/plugins-phase-2-hosts.md §3.F).
// The fiche's CGV line and the devis origin badge stay core, behind usePlugin (rule 26).
import { lazy } from 'react';

export default {
  id: 'website-booking',
  contributes: {
    // Last of the plugin alerts: the requests wait for the operator, they do not burn.
    'dashboard.alerts': [{ key: 'site-requests', order: 90, Component: lazy(() => import('./DevisPublicRequestAlert')) }],
    // Paramètres › Conditions générales: the two alerts and the « Réservation en ligne » card.
    'terms.settings': [{ key: 'online-booking', order: 10, Component: lazy(() => import('./OnlineBookingCard')) }],
  },
};
