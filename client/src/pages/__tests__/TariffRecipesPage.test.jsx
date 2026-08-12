import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

import TariffRecipesPage from '../TariffRecipesPage';
import api from '../../api';

// specs/tariff-recipes/spec.md §3.5 rules 26-28 — the read-only browser distinguishes bundled,
// local-override and invalid recipes, and lists the properties using each.

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getTariffRecipes: vi.fn(),
    getTariffRecipe: vi.fn(),
  },
}));

const renderPage = () => render(<MemoryRouter><TariffRecipesPage /></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); });

test('renders bundled and local-override recipes distinctly, with their properties', async () => {
  api.getTariffRecipes.mockResolvedValue({
    recipes: [
      { id: 'aventura-lodge-2026', label: 'Aventura 2026', version: '1.0.0', source: 'bundled', overridesBundled: false, usedByProperties: [{ id: 1, name: 'Aventura Lodge', appliedVersion: '1.0.0' }] },
      { id: 'gite-2026', label: 'Gîte 2026', version: '2.0.0', source: 'local', overridesBundled: true, usedByProperties: [] },
    ],
    invalid: [],
  });
  renderPage();
  await waitFor(() => expect(api.getTariffRecipes).toHaveBeenCalled());
  expect(screen.getByText('Livrée')).toBeInTheDocument();
  expect(screen.getByText('Locale')).toBeInTheDocument();
  expect(screen.getByText('Écrase la version livrée')).toBeInTheDocument();
  expect(screen.getByText('Aventura Lodge')).toBeInTheDocument();
  expect(screen.getByText('Utilisée par aucun logement')).toBeInTheDocument();
});

test('a property on an older applied version is flagged', async () => {
  api.getTariffRecipes.mockResolvedValue({
    recipes: [
      { id: 'r', label: 'R', version: '1.1.0', source: 'bundled', overridesBundled: false, usedByProperties: [{ id: 1, name: 'Lodge', appliedVersion: '1.0.0' }] },
    ],
    invalid: [],
  });
  renderPage();
  await waitFor(() => expect(screen.getByText('Lodge (v1.0.0 appliquée)')).toBeInTheDocument());
});

test('an invalid recipe surfaces as an error card naming its file', async () => {
  api.getTariffRecipes.mockResolvedValue({
    recipes: [],
    invalid: [{ file: 'broken.json', source: 'local', error: 'JSON invalide — Unexpected token' }],
  });
  renderPage();
  await waitFor(() => expect(screen.getByText(/broken.json/)).toBeInTheDocument());
  expect(screen.getByText(/JSON invalide/)).toBeInTheDocument();
});

test('expanding a recipe fetches and shows its document', async () => {
  api.getTariffRecipes.mockResolvedValue({
    recipes: [{ id: 'r', label: 'R', version: '1.0.0', source: 'bundled', overridesBundled: false, usedByProperties: [] }],
    invalid: [],
  });
  api.getTariffRecipe.mockResolvedValue({ recipe: { id: 'r', seasons: [{ key: 'low' }] } });
  renderPage();
  await waitFor(() => expect(api.getTariffRecipes).toHaveBeenCalled());
  fireEvent.click(screen.getByLabelText('Document r'));
  await waitFor(() => expect(api.getTariffRecipe).toHaveBeenCalledWith('r'));
  await waitFor(() => expect(screen.getByText(/"key": "low"/)).toBeInTheDocument());
});

test('no recipe at all → empty state', async () => {
  api.getTariffRecipes.mockResolvedValue({ recipes: [], invalid: [] });
  renderPage();
  await waitFor(() => expect(screen.getByText('Aucune recette tarifaire.')).toBeInTheDocument());
});
