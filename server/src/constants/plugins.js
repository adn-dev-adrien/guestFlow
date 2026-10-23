// Built-in plugin catalogue (specs/plugins-phase-0-foundation.md §3.A). The twelve optional features
// the owner arbitrated on 2026-09-28 (specs/plugins-inventory.md §5.3); everything else is core.
// Mirrored client-side in client/src/constants/plugins.js (ids only).

const { readSourceManifest } = require('../plugins/manifest');

const HOURLY_RESOURCES = 'hourly-resources';
const LINEN = 'linen';
const WEBSITE_BOOKING = 'website-booking';
const GATE_ACCESS = 'gate-access';
const NEAT = 'neat';
const ONLINE_PAYMENT = 'online-payment';
const GOOGLE_CALENDAR = 'google-calendar';
const ACCOUNTING_EXPORT = 'accounting-export';
const SAS = 'sas';
const TARIFF_RECIPES = 'tariff-recipes';
const SCHOOL_HOLIDAYS = 'school-holidays';
const WEATHER_ALERTS = 'weather-alerts';
const GITES_DE_FRANCE_INTAKE = 'gites-de-france-intake';
const BOOKING_INTAKE = 'booking-intake';

// specs/plugins-phase-4-registry.md rule 2 — each plugin's manifest is its single description; this
// list only fixes the order the Plugins page shows them in. A version installed from the registry
// carries its own manifest in the `plugins` row (rule 11); this catalogue is what the core ships.
const CATALOG_ORDER = [
  HOURLY_RESOURCES, LINEN, WEBSITE_BOOKING, GATE_ACCESS, NEAT, ONLINE_PAYMENT,
  GOOGLE_CALENDAR, ACCOUNTING_EXPORT, SAS, TARIFF_RECIPES, SCHOOL_HOLIDAYS, WEATHER_ALERTS,
  GITES_DE_FRANCE_INTAKE, BOOKING_INTAKE,
];

const PLUGIN_CATALOG = Object.freeze(CATALOG_ORDER.map((id) => readSourceManifest(id)));

const PLUGIN_IDS = Object.freeze(PLUGIN_CATALOG.map((p) => p.id));

// specs/plugins-phase-0-foundation.md rule 10 — what an existing database gets installed and active:
// the twelve features that were core before phase 0, so nothing disappears. A plugin added since
// (the two intakes) is a new opt-in and is never installed by the seed.
const SEEDED_ON_EXISTING_IDS = Object.freeze([
  HOURLY_RESOURCES, LINEN, WEBSITE_BOOKING, GATE_ACCESS, NEAT, ONLINE_PAYMENT,
  GOOGLE_CALENDAR, ACCOUNTING_EXPORT, SAS, TARIFF_RECIPES, SCHOOL_HOLIDAYS, WEATHER_ALERTS,
]);

// specs/plugins-phase-p-productisation.md rule 40 — the pages that exist only with a plugin, known
// even when that plugin is not installed (a release ships its pages in the plugin's own bundle). A
// path matches itself and the paths below it. Kept in step with each plugin's `contributes.routes`
// by tests/plugin-page-owner.unit.test.js.
const PLUGIN_PAGES = Object.freeze({
  '/comptabilite': [ACCOUNTING_EXPORT],
  '/resource-planning': [HOURLY_RESOURCES],
  '/parametres/stock-blanchisserie': [LINEN],
  '/parametres/paiements': [ONLINE_PAYMENT],
  '/finance/rapprochement': [ONLINE_PAYMENT],
  '/school-holidays': [SCHOOL_HOLIDAYS],
  '/parametres/recettes': [TARIFF_RECIPES],
  '/settings/integrations': [WEBSITE_BOOKING, GOOGLE_CALENDAR, NEAT, WEATHER_ALERTS, GATE_ACCESS, GITES_DE_FRANCE_INTAKE, BOOKING_INTAKE],
});

// specs/plugins-phase-0-foundation.md rule 25 — where each plugin is set up: the page its card's
// « Configurer » / « Réglages » opens. A section of Intégrations is reached by its anchor
// (`#plugin-<id>`, IntegrationsSettingsPage). `null`: nothing to set up (the card has no such button).
const INTEGRATIONS = '/settings/integrations';
const PLUGIN_SETTINGS_PLACES = Object.freeze({
  [HOURLY_RESOURCES]: '/parametres/options-ressources',
  [LINEN]: '/parametres/stock-blanchisserie',
  [WEBSITE_BOOKING]: `${INTEGRATIONS}#plugin-${WEBSITE_BOOKING}`,
  [GATE_ACCESS]: `${INTEGRATIONS}#plugin-${GATE_ACCESS}`,
  [NEAT]: `${INTEGRATIONS}#plugin-${NEAT}`,
  [ONLINE_PAYMENT]: '/parametres/paiements',
  [GOOGLE_CALENDAR]: `${INTEGRATIONS}#plugin-${GOOGLE_CALENDAR}`,
  [ACCOUNTING_EXPORT]: '/comptabilite/plateformes',
  [SAS]: null,
  [TARIFF_RECIPES]: '/parametres/recettes',
  [SCHOOL_HOLIDAYS]: '/parametres/vacances-fermetures',
  [WEATHER_ALERTS]: `${INTEGRATIONS}#plugin-${WEATHER_ALERTS}`,
  [GITES_DE_FRANCE_INTAKE]: `${INTEGRATIONS}#plugin-${GITES_DE_FRANCE_INTAKE}`,
  [BOOKING_INTAKE]: `${INTEGRATIONS}#plugin-${BOOKING_INTAKE}`,
});

/** → the ids of the plugins a page belongs to, or [] for a core page or an unknown address. */
function pluginsOfPage(path) {
  const clean = String(path || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const key = Object.keys(PLUGIN_PAGES).find((p) => clean === p || clean.startsWith(`${p}/`));
  return key ? [...PLUGIN_PAGES[key]] : [];
}

function findPlugin(id) {
  return PLUGIN_CATALOG.find((p) => p.id === id) || null;
}

module.exports = {
  HOURLY_RESOURCES,
  LINEN,
  WEBSITE_BOOKING,
  GATE_ACCESS,
  NEAT,
  ONLINE_PAYMENT,
  GOOGLE_CALENDAR,
  ACCOUNTING_EXPORT,
  SAS,
  TARIFF_RECIPES,
  SCHOOL_HOLIDAYS,
  WEATHER_ALERTS,
  PLUGIN_CATALOG,
  PLUGIN_IDS,
  SEEDED_ON_EXISTING_IDS,
  findPlugin,
  PLUGIN_PAGES,
  PLUGIN_SETTINGS_PLACES,
  pluginsOfPage,
};
