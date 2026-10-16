// The host side of the plugin bundles in a production build (specs/plugins-phase-4-registry.md
// rules 5, 18, P27). A plugin's own ES module is built with React, MUI, the router and the SDK as
// externals; `scripts/build-plugin-packages.mjs` turns each of those imports into a read of
// `globalThis.__GUESTFLOW_HOST__.modules`, filled here with this app's own modules — one React, one
// MUI theme. Then every entry the server lists is imported, BEFORE the app modules evaluate, so the
// menus, routes and slots computed from the module list see the plugins (`index.jsx`).
//
// A bundle that fails to load is left out and remembered: the Plugins page shows it as failed, and
// the rest of the app renders.
import * as React from 'react';
import * as JsxRuntime from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import * as ReactRouter from 'react-router';
import * as Mui from '@mui/material';
import * as MuiStyles from '@mui/material/styles';
import * as MuiColors from '@mui/material/colors';
import * as MuiUtils from '@mui/material/utils';
import * as Sdk from './sdk';
import * as SdkUi from './sdk/ui';
import PLUGIN_MODULES, { BUNDLE_FAILURES } from './runtimeModules';

// Same keys as hostModules.json — the list the package build accepts as externals.
export const HOST_MODULES = Object.freeze({
  react: React,
  'react/jsx-runtime': JsxRuntime,
  'react-dom': ReactDOM,
  'react-router': ReactRouter,
  '@mui/material': Mui,
  '@mui/material/styles': MuiStyles,
  '@mui/material/colors': MuiColors,
  '@mui/material/utils': MuiUtils,
  'guestflow/sdk': Sdk,
  'guestflow/sdk/ui': SdkUi,
});

const defaultImporter = (url) => import(/* @vite-ignore */ url);

/** Imports the bundle of every plugin the server lists (`/plugin-assets/entries.json`). */
export async function loadPluginBundles({ fetchImpl = fetch, importer = defaultImporter, target = PLUGIN_MODULES, failures = BUNDLE_FAILURES } = {}) {
  globalThis.__GUESTFLOW_HOST__ = { modules: HOST_MODULES };
  let entries = [];
  try {
    const res = await fetchImpl('/plugin-assets/entries.json', { credentials: 'same-origin' });
    entries = res.ok ? await res.json() : [];
  } catch {
    entries = [];
  }
  const results = await Promise.allSettled(entries.map((entry) => importer(entry.url)));
  results.forEach((result, i) => {
    const entry = entries[i];
    const mod = result.status === 'fulfilled' && result.value ? result.value.default : null;
    if (mod && mod.id === entry.id) {
      target.push(mod);
      return;
    }
    failures.set(entry.id, result.status === 'rejected' && result.reason ? String(result.reason.message || result.reason) : 'module invalide');
    // eslint-disable-next-line no-console
    console.error(`[plugin:${entry.id}] bundle not loaded:`, failures.get(entry.id));
  });
  return target;
}
