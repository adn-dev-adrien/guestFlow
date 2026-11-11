// specs/plugins-phase-4-registry.md rule 44 — a plugin tab that throws leaves the page bar and the other tab up.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const Throws = () => { throw new Error('boom'); };
vi.mock('../../plugins/sdk/useSlot', () => ({
  useSlot: () => [{ key: 'school', pluginId: 'school-holidays', label: 'Vacances scolaires', Component: Throws }],
}));
vi.mock('../EstablishmentClosuresPage', () => ({ default: () => <div>closures</div> }));

import SeasonsClosuresPage from '../SeasonsClosuresPage';
import RouteErrorBoundary from '../../components/ErrorBoundary';

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

test('a throwing plugin tab does not reach the route error screen', () => {
  render(<MemoryRouter><RouteErrorBoundary><p>coque</p><SeasonsClosuresPage /></RouteErrorBoundary></MemoryRouter>);
  expect(screen.getByText('coque')).toBeInTheDocument();
  expect(screen.queryByText(/Une erreur est survenue/)).toBeNull();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[plugin:school-holidays]'), expect.any(Error));
});
