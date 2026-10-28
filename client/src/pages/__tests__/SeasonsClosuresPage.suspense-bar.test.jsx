// specs/ds-tabs.md rule 12 — the default plugin tab of Vacances & fermetures keeps the bar (title, tabs,
// an action-sized slot) drawn while its chunk loads, instead of a bare skeleton; its page has no Save,
// so the fallback shows none.
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

test('rule 12 — while the plugin tab loads, the tabs and the title are on screen, and no Save / Cancel the page does not have', async () => {
  render(<MemoryRouter><SeasonsClosuresPage /></MemoryRouter>);
  expect(screen.queryByTestId('loaded')).toBeNull();
  expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getAllByText('Vacances scolaires').length).toBeGreaterThan(0);
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  await act(async () => { release(); });
  expect(await screen.findByTestId('loaded')).toBeInTheDocument();
  expect(screen.getAllByRole('tab')).toHaveLength(2);
});
