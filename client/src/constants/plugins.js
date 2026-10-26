// Client mirror of server/src/constants/plugins.js (ids only — the server owns the catalogue and the
// states; the client only hides what `user.enabledPlugins` does not list).
// specs/plugins-phase-0-foundation.md rules 14 and 16; specs/plugins-phase-1-sdk.md rule 15.
import PLUGIN_MODULES from '../plugins';
import liveRecord from '../utils/liveRecord';

export const HOURLY_RESOURCES = 'hourly-resources';
export const LINEN = 'linen';
export const WEBSITE_BOOKING = 'website-booking';
export const GATE_ACCESS = 'gate-access';
export const NEAT = 'neat';
export const ONLINE_PAYMENT = 'online-payment';
export const GOOGLE_CALENDAR = 'google-calendar';
export const ACCOUNTING_EXPORT = 'accounting-export';
export const SAS = 'sas';
export const TARIFF_RECIPES = 'tariff-recipes';
export const SCHOOL_HOLIDAYS = 'school-holidays';
export const WEATHER_ALERTS = 'weather-alerts';
export const GITES_DE_FRANCE_INTAKE = 'gites-de-france-intake';
export const BOOKING_INTAKE = 'booking-intake';
export const AIRBNB_INTAKE = 'airbnb-intake';
export const GOOGLE_VACATION_RENTALS = 'google-vacation-rentals';

export const PLUGIN_IDS = Object.freeze([
  HOURLY_RESOURCES, LINEN, WEBSITE_BOOKING, GATE_ACCESS, NEAT, ONLINE_PAYMENT,
  GOOGLE_CALENDAR, ACCOUNTING_EXPORT, SAS, TARIFF_RECIPES, SCHOOL_HOLIDAYS, WEATHER_ALERTS,
  GITES_DE_FRANCE_INTAKE, BOOKING_INTAKE, AIRBNB_INTAKE, GOOGLE_VACATION_RENTALS,
]);

// The pages plugin modules contribute, with the roles that may open them (rule 15). Read live:
// a production build fills the module list after this file evaluated
// (specs/plugins-phase-4-registry.md rule 18).
const moduleRoutes = () => PLUGIN_MODULES.flatMap((mod) => ((mod.contributes && mod.contributes.routes) || [])
  .map((route) => ({ ...route, pluginId: mod.id })));
const modulesVersion = () => PLUGIN_MODULES.length;

export const MODULE_ROUTE_ROLES = liveRecord(
  () => Object.fromEntries(moduleRoutes().map((route) => [route.path, route.roles || ['admin']])),
  modulesVersion,
);

// Pages that only exist for a plugin. An array means « visible while any of them is active »
// (Intégrations holds the sections of eight plugins). Plugin modules add their own pages.
export const ROUTE_PLUGINS = liveRecord(() => ({
  '/settings/integrations': [WEBSITE_BOOKING, GOOGLE_CALENDAR, NEAT, WEATHER_ALERTS, GATE_ACCESS, GITES_DE_FRANCE_INTAKE, BOOKING_INTAKE, AIRBNB_INTAKE, GOOGLE_VACATION_RENTALS],
  ...Object.fromEntries(moduleRoutes().map((route) => [route.path, route.pluginId])),
}), modulesVersion);

export function isPluginEnabled(user, id) {
  return Boolean(user && Array.isArray(user.enabledPlugins) && user.enabledPlugins.includes(id));
}

export function isRouteEnabled(user, path) {
  const owner = ROUTE_PLUGINS[path];
  if (!owner) return true;
  return (Array.isArray(owner) ? owner : [owner]).some((id) => isPluginEnabled(user, id));
}
