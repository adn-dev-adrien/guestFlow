// specs/plugins-phase-4-registry.md rule 39 — a plugin contribution that throws, or whose lazy chunk
// is gone after an update, never takes the page down: it renders nothing (and is logged), or a
// small « Recharger » prompt for a stale bundle. The other contributions keep rendering.
import React, { lazy } from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

const contributions = [];
vi.mock('../useSlot', () => ({ useSlot: () => contributions }));

import Slot from '../Slot';

const Good = () => <p>contribution saine</p>;
const Throws = () => { throw new Error('boom'); };
const Stale = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /plugin-assets/x.js')));

beforeEach(() => {
  contributions.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

test('a throwing contribution renders nothing, is logged, and its neighbours stay', () => {
  contributions.push({ key: 'a', pluginId: 'bad', Component: Throws }, { key: 'b', pluginId: 'good', Component: Good });
  render(<Slot name="x" />);
  expect(screen.getByText('contribution saine')).toBeTruthy();
  expect(screen.queryByText('Recharger')).toBeNull();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugin:bad]'), expect.any(Error));
});

test('a lazy chunk that 404s shows a small « Recharger » prompt, not a crash', async () => {
  contributions.push({ key: 'a', pluginId: 'old', Component: Stale }, { key: 'b', pluginId: 'good', Component: Good });
  render(<Slot name="x" />);
  expect(await screen.findByText('Recharger')).toBeTruthy();
  expect(screen.getByText('contribution saine')).toBeTruthy();
});
