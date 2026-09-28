// Recettes tarifaires — client module (specs/plugins-phase-1-sdk.md §3.C).
import { lazy } from 'react';
import MenuBookIcon from '@mui/icons-material/MenuBook';

export default {
  id: 'tariff-recipes',
  contributes: {
    routes: [{ path: '/parametres/recettes', Component: lazy(() => import('./TariffRecipesPage')), roles: ['admin'] }],
    'settings.menu': [{
      path: '/parametres/recettes', label: 'Recettes tarifaires', Icon: MenuBookIcon, after: '/parametres/options-ressources',
    }],
    'dashboard.alerts': [{ key: 'recipe-runs', order: 10, Component: lazy(() => import('./TariffRecipeRunsAlert')) }],
    // The recipe card of Logement › Tarifs & saisons.
    'property.tariff': [{ key: 'recipe-card', order: 10, Component: lazy(() => import('./TariffRecipeCard')) }],
  },
};
