// specs/plugins-phase-4-registry.md rule 44 — a contributed tab that throws leaves the page up.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const Throws = () => { throw new Error('boom'); };
vi.mock('../../plugins/sdk/useSlot', () => ({
  useSlot: () => [{ key: 'sas', pluginId: 'sas', value: 'sas', label: 'Facturables au SAS', order: 30, Component: Throws }],
}));
vi.mock('../OptionsPage', () => ({ default: () => <div>options</div> }));
vi.mock('../ResourcesPage', () => ({ default: () => <div>resources</div> }));

import OptionsResourcesPage from '../OptionsResourcesPage';
import RouteErrorBoundary from '../../components/ErrorBoundary';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

test('a throwing contributed tab does not reach the route error screen', () => {
  render(
    <MemoryRouter initialEntries={['/parametres/options-ressources?tab=sas']}>
      <RouteErrorBoundary><p>coque</p><OptionsResourcesPage /></RouteErrorBoundary>
    </MemoryRouter>,
  );
  expect(screen.getByText('coque')).toBeInTheDocument();
  expect(screen.queryByText(/Une erreur est survenue/)).toBeNull();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugin:sas]'), expect.any(Error));
});
