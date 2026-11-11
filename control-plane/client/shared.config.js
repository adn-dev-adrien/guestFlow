// Shared by vite.config.js and vitest.config.js (specs/control-plane-plans-and-access.md §4.2, Q6).
//
// The console reuses GuestFlow's theme and generic components straight from `client/src`, imported
// as `@gf/…`. Those files import React, MUI and the router by bare name; left alone, Node-style
// resolution would look for them in `client/node_modules` — a second copy of React (hooks break), and
// absent altogether in the console's CI job. Every such package is therefore aliased to the
// console's own `node_modules`, so both trees share one copy.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nm = (pkg) => path.join(here, 'node_modules', pkg);

export const SHARED_PACKAGES = ['react', 'react-dom', 'react-router', '@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'];

export const alias = [
  { find: /^@gf\//, replacement: `${path.resolve(here, '..', '..', 'client', 'src')}/` },
  ...SHARED_PACKAGES.map((pkg) => ({ find: new RegExp(`^${pkg.replace('/', '\\/')}(?=/|$)`), replacement: nm(pkg) })),
];

export const gfRoot = path.resolve(here, '..', '..');
