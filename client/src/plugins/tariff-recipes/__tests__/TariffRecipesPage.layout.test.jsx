import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import TariffRecipesPage from '../TariffRecipesPage';
import api from '../../../api';

// specs/tariff-recipes/spec.md §3.5 (2026-10-27 audit) — the bar sat inside the page padding (24 px
// lower and narrower than on every other page) and the journal used a bold h6 instead of the
// design-system `sectionHeader` role (specs/design-system.md §3.2).

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getTariffRecipes: vi.fn().mockResolvedValue({ recipes: [], invalid: [] }),
    getTariffChangeJournal: vi.fn().mockResolvedValue({ events: [] }),
    getProperties: vi.fn().mockResolvedValue([]),
  },
}));

test('the action bar is the first child of the page, outside the padded content', async () => {
  const { container } = render(<MemoryRouter><TariffRecipesPage /></MemoryRouter>);
  await screen.findByText('Aucune recette tarifaire.');
  const page = container.firstChild;
  expect(page.firstChild.hasAttribute('data-sticky-bar')).toBe(true);
  expect(window.getComputedStyle(page).padding).not.toMatch(/[1-9]\d*px/);
});

test('« Journal des changements » is a section heading (h2), not an h6', async () => {
  render(<MemoryRouter><TariffRecipesPage /></MemoryRouter>);
  expect(await screen.findByRole('heading', { level: 2, name: 'Journal des changements' })).toBeInTheDocument();
});
