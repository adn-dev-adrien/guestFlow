// Vigilance Météo-France — client module (specs/plugins-phase-1-sdk.md §3.C).
import { lazy } from 'react';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';

export default {
  id: 'weather-alerts',
  contributes: {
    'settings.integrations': [
      { key: 'weather', order: 30, Component: lazy(() => import('./SettingsWeatherSection')) },
    ],
    // Arrival only, just before the recap, when an orange/red alert overlaps the stay.
    'sas.arrival.steps': [{
      key: 'weather',
      title: 'Alerte météo',
      Icon: ReportProblemIcon,
      load: (args) => import('./sasStep').then((m) => m.load(args)),
      isShown: (alerts) => Array.isArray(alerts) && alerts.length > 0,
      Component: lazy(() => import('./sasStep')),
    }],
  },
};
