// The plugin modules of a production build (specs/plugins-phase-4-registry.md rules 18, P27): filled
// by `runtime.js` from each active plugin's own bundle before the app renders. The build redirects
// every import of `plugins/index.js` here (vite.config.js), so the core reads one list either way.
const PLUGIN_MODULES = [];

// id → why its bundle did not load (rule 18). Read by the Plugins page; always empty in development,
// where the sources are imported directly.
export const BUNDLE_FAILURES = new Map();

export default PLUGIN_MODULES;
