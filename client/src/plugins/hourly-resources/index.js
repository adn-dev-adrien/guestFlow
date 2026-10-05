// Ressources à l'heure — client module (specs/plugins-phase-3c-hourly-resources.md §3.E): the
// Calendrier › Ressources page, the hourly block of the resource form, the sessions under a fiche
// line, the « Planifier » step of the arrival SAS and the timed cards of the planning.
import { lazy } from 'react';
import HotTubIcon from '@mui/icons-material/HotTub';
import {
  initialValue, payloadOf, recapLines, recapNotes,
} from './sasStep';
import { countResourceTasks } from './planningTasks';

const isPerHour = (resource) => resource && resource.priceType === 'per_hour';

export default {
  id: 'hourly-resources',
  contributes: {
    routes: [{ path: '/resource-planning', Component: lazy(() => import('./ResourcePlanningPage')), roles: ['admin'] }],
    'calendar.menu': [{ path: '/resource-planning', label: 'Ressources' }],
    'resources.fields': [{
      key: 'hourly', appliesTo: isPerHour, Component: lazy(() => import('./HourlyResourceFields')),
    }],
    'reservation.resourceLine': [{
      key: 'sessions',
      appliesTo: (resource) => isPerHour(resource) && Boolean(resource.showsPlanningCard),
      Component: lazy(() => import('./ResourceSessionsPicker')),
    }],
    // Right after the read-only prestations list (specs/hourly-resource-quantity-and-sas-scheduling.md
    // §3.4 rule 17), while hours are left to place.
    'sas.arrival.steps': [{
      key: 'resourceScheduling',
      title: 'Planifier',
      Icon: HotTubIcon,
      after: 'options',
      isShown: (data) => Boolean(data && data.applicable),
      skipLabel: 'Planifier plus tard',
      initialValue,
      payloadOf,
      recapLines,
      recapNotes,
      Component: lazy(() => import('./SasSchedulingStep')),
    }],
    'planning.days': [{
      key: 'resources',
      order: 5,
      timed: true,
      load: (range) => import('./planningDays').then((m) => m.loadResourceDays(range)),
      countTasks: countResourceTasks,
      Component: lazy(() => import('./PlanningResourceCard')),
      errorMessage: "Les ressources n'ont pas pu être chargées.",
    }],
  },
};
