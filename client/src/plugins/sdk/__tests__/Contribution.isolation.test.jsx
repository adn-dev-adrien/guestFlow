// specs/plugins-phase-4-registry.md rule 44 — a host that mounts a plugin `Component` itself (not through
// `<Slot>`) wraps it in `<Contribution>`: a throwing one renders nothing and is logged, a stale lazy chunk
// shows « Recharger », and the page around it stays up.
import React, { lazy } from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { Contribution } from '../Slot';

const Throws = () => { throw new Error('boom'); };
const Stale = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /plugin-assets/x.js')));

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

test('a throwing contribution renders nothing, is logged, and the page around it stays', () => {
  render(<main><p>page</p><Contribution pluginId="bad"><Throws /></Contribution></main>);
  expect(screen.getByText('page')).toBeInTheDocument();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugin:bad]'), expect.any(Error));
});

test('a stale lazy chunk shows « Recharger » and the page around it stays', async () => {
  render(<main><p>page</p><Contribution pluginId="old"><Stale /></Contribution></main>);
  expect(await screen.findByText('Recharger')).toBeInTheDocument();
  expect(screen.getByText('page')).toBeInTheDocument();
});

test('the fallback shows while the chunk loads', () => {
  const Pending = lazy(() => new Promise(() => {}));
  render(<Contribution pluginId="slow" fallback={<p>chargement</p>}><Pending /></Contribution>);
  expect(screen.getByText('chargement')).toBeInTheDocument();
});
