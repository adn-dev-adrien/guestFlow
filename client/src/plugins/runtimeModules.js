// The plugin modules of a production build (specs/plugins-phase-4-registry.md rules 18, P27): filled
// by `runtime.js` from each active plugin's own bundle before the app renders. The build redirects
// every import of `plugins/index.js` here (vite.config.js), so the core reads one list either way.
const PLUGIN_MODULES = [];

// id → why its bundle did not load (rule 18). Read by the Plugins page; always empty in development,
// where the sources are imported directly.
export const BUNDLE_FAILURES = new Map();

// Set when the list of bundles could not be read (review minor 8): the app then renders without its
// plugins and says so, instead of looking complete.
export const LOAD_STATE = { entriesError: null };

export default PLUGIN_MODULES;
