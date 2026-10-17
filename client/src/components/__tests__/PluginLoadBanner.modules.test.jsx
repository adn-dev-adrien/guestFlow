// specs/plugins-phase-4-registry.md rule 18 (review of 2026-10-17) — when the plugin bundles could
// not be listed, the app says so and offers a reload instead of looking complete.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import PluginLoadBanner from '../PluginLoadBanner';
import { LOAD_STATE } from '../../plugins/runtimeModules';

afterEach(() => { LOAD_STATE.entriesError = null; });

test('rule 18: nothing while the bundles were listed', () => {
  const { container } = render(<PluginLoadBanner />);
  expect(container).toBeEmptyDOMElement();
});

test('rule 18: « Modules indisponibles » with « Recharger » when the list failed', async () => {
  LOAD_STATE.entriesError = 'HTTP 502';
  const onReload = vi.fn();
  render(<PluginLoadBanner onReload={onReload} />);
  expect(screen.getByText('Modules indisponibles.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Recharger' }));
  expect(onReload).toHaveBeenCalled();
});
