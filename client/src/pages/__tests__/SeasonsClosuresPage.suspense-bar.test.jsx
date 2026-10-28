// specs/ds-tabs.md rule 12 — the default plugin tab of Vacances & fermetures keeps the bar (title, tabs,
// Save / Cancel slots) drawn while its chunk loads, instead of a bare skeleton.
import React, { lazy } from 'react';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

let release;
const Lazy = lazy(() => new Promise((resolve) => {
  release = () => resolve({ default: ({ barTabs }) => <div data-testid="loaded">{barTabs}</div> });
}));

vi.mock('../../plugins/sdk/useSlot', () => ({
  useSlot: () => [{ key: 'school', label: 'Vacances scolaires', Component: Lazy }],
}));
vi.mock('../EstablishmentClosuresPage', () => ({ default: () => <div>closures</div> }));

import SeasonsClosuresPage from '../SeasonsClosuresPage';

test('rule 12 — while the plugin tab loads, the tabs, the title and the Save / Cancel slots are on screen', async () => {
  render(<MemoryRouter><SeasonsClosuresPage /></MemoryRouter>);
  expect(screen.queryByTestId('loaded')).toBeNull();
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getAllByText('Vacances scolaires').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await act(async () => { release(); });
  expect(await screen.findByTestId('loaded')).toBeInTheDocument();
  expect(screen.getAllByRole('tab')).toHaveLength(2);
});
