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

// specs/plugins-phase-4-registry.md rule 2 — each plugin's manifest is its single description; this
// list only fixes the order the Plugins page shows them in. A version installed from the registry
// carries its own manifest in the `plugins` row (rule 11); this catalogue is what the core ships.
const CATALOG_ORDER = [
  HOURLY_RESOURCES, LINEN, WEBSITE_BOOKING, GATE_ACCESS, NEAT, ONLINE_PAYMENT,
  GOOGLE_CALENDAR, ACCOUNTING_EXPORT, SAS, TARIFF_RECIPES, SCHOOL_HOLIDAYS, WEATHER_ALERTS,
];

const PLUGIN_CATALOG = Object.freeze(CATALOG_ORDER.map((id) => readSourceManifest(id)));

const PLUGIN_IDS = Object.freeze(PLUGIN_CATALOG.map((p) => p.id));

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
  findPlugin,
};
