// specs/ds-tabs.md rule 12 — switching to a plugin tab whose chunk is still loading keeps the bar
// (title + tabs) drawn: the page never blinks to nothing between two tabs.
import React, { lazy } from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

let release;
const Lazy = lazy(() => new Promise((resolve) => {
  release = () => resolve({ default: ({ barTabs }) => <div data-testid="loaded">{barTabs}</div> });
}));

vi.mock('../../plugins/sdk/useSlot', () => ({
  useSlot: () => [{ key: 'sas', value: 'sas', label: 'Facturables au SAS', order: 30, Component: Lazy }],
}));
vi.mock('../OptionsPage', () => ({ default: () => <div>options</div> }));
vi.mock('../ResourcesPage', () => ({ default: () => <div>resources</div> }));

import OptionsResourcesPage from '../OptionsResourcesPage';

test('rule 12 — while a contributed tab loads, the tabs and its title stay on screen', async () => {
  render(
    <MemoryRouter initialEntries={['/parametres/options-ressources?tab=sas']}>
      <OptionsResourcesPage />
    </MemoryRouter>,
  );
  expect(screen.queryByTestId('loaded')).toBeNull();
  expect(screen.getAllByRole('tab')).toHaveLength(3);
  expect(screen.getAllByText('Facturables au SAS').length).toBeGreaterThan(0);
  await act(async () => { release(); });
  expect(await screen.findByTestId('loaded')).toBeInTheDocument();
  expect(screen.getAllByRole('tab')).toHaveLength(3);
});
