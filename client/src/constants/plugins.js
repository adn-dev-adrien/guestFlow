// Client mirror of server/src/constants/plugins.js (ids only — the server owns the catalogue and the
// states; the client only hides what `user.enabledPlugins` does not list).
// specs/plugins-phase-0-foundation.md rules 14 and 16.

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

export const PLUGIN_IDS = Object.freeze([
  HOURLY_RESOURCES, LINEN, WEBSITE_BOOKING, GATE_ACCESS, NEAT, ONLINE_PAYMENT,
  GOOGLE_CALENDAR, ACCOUNTING_EXPORT, SAS, TARIFF_RECIPES, SCHOOL_HOLIDAYS, WEATHER_ALERTS,
]);

// Pages that only exist for a plugin. An array means « visible while any of them is active »
// (Intégrations holds the sections of four plugins).
export const ROUTE_PLUGINS = Object.freeze({
  '/resource-planning': HOURLY_RESOURCES,
  '/comptabilite': ACCOUNTING_EXPORT,
  '/comptabilite/plateformes': ACCOUNTING_EXPORT,
  '/school-holidays': SCHOOL_HOLIDAYS,
  '/parametres/stock-blanchisserie': LINEN,
  '/parametres/recettes': TARIFF_RECIPES,
  '/parametres/paiements': ONLINE_PAYMENT,
  '/settings/integrations': [GOOGLE_CALENDAR, NEAT, WEATHER_ALERTS, GATE_ACCESS],
});

export function isPluginEnabled(user, id) {
  return Boolean(user && Array.isArray(user.enabledPlugins) && user.enabledPlugins.includes(id));
}

export function isRouteEnabled(user, path) {
  const owner = ROUTE_PLUGINS[path];
  if (!owner) return true;
  return (Array.isArray(owner) ? owner : [owner]).some((id) => isPluginEnabled(user, id));
}
