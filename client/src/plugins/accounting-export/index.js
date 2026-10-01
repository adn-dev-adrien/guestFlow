// Export comptable — client module (specs/plugins-phase-2-hosts.md rule 19). Its two pages are opened
// by the admin and the accountant; the accountant lands on Comptabilité while the plugin is live.
import { lazy } from 'react';

const ROLES = ['admin', 'accountant'];

export default {
  id: 'accounting-export',
  contributes: {
    routes: [
      { path: '/comptabilite', Component: lazy(() => import('./AccountingPage')), roles: ROLES },
      { path: '/comptabilite/plateformes', Component: lazy(() => import('./PlatformAccountsPage')), roles: ROLES },
    ],
    // « Suivi financier » submenu, after the core's « Indemnités d'annulation » (order 30).
    'finance.menu': [
      { key: 'accounting', path: '/comptabilite', label: 'Comptabilité', order: 40, roles: ROLES },
      { key: 'account-plan', path: '/comptabilite/plateformes', label: 'Plan comptable', order: 50, roles: ROLES },
    ],
    // The « Plan comptable » links of Paramètres › Plateformes and › TVA & exercice.
    'settings.platforms.links': [{ key: 'account-plan', Component: lazy(() => import('./PlatformAccountsLink')) }],
  },
};
