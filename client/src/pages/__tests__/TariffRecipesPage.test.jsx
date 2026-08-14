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
    // specs/tariff-change-journal.md §6 — la page porte aussi le journal des changements
    getTariffChangeJournal: vi.fn(),
    addTariffChangeEvent: vi.fn(),
    deleteTariffChangeEvent: vi.fn(),
    getProperties: vi.fn(),
  },
}));

const renderPage = () => render(<MemoryRouter><TariffRecipesPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  // Défauts pour le journal : chaque test de recette rend la page entière.
  api.getTariffChangeJournal.mockResolvedValue({ events: [] });
  api.getProperties.mockResolvedValue([{ id: 1, name: 'Aventura lodge' }]);
});

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

// ── Journal des changements tarifaires (specs/tariff-change-journal.md §6) ─────────────────────

test('le journal affiche la date d’effet et signale une date déduite', async () => {
  api.getTariffRecipes.mockResolvedValue({ recipes: [], invalid: [] });
  api.getTariffChangeJournal.mockResolvedValue({
    events: [
      {
        id: 2, propertyId: 1, propertyName: 'Aventura lodge', kind: 'platforms',
        kindLabel: 'Mise en ligne sur les plateformes', recipeId: 'aventura-lodge-2026',
        recipeVersion: '1.1.0', occurredAt: '2026-08-14 11:00:00', source: 'manual',
        note: '', createdAt: '2026-08-14 11:05:00', inferred: false,
      },
      {
        id: 1, propertyId: 1, propertyName: 'Aventura lodge', kind: 'recipe',
        kindLabel: 'Recette appliquée', recipeId: 'aventura-lodge-2026', recipeVersion: '1.1.0',
        occurredAt: '2026-08-12 16:08:41', source: 'backfill', note: '',
        createdAt: '2026-08-20 09:00:00', inferred: true,
      },
    ],
  });
  renderPage();

  await waitFor(() => expect(screen.getByText('Mise en ligne sur les plateformes')).toBeInTheDocument());
  expect(screen.getByText('14 août 2026 à 11:00')).toBeInTheDocument();
  expect(screen.getByText('12 août 2026 à 16:08')).toBeInTheDocument();
  // Une date déduite doit se présenter comme telle, et le décalage de saisie être visible.
  expect(screen.getByText('date déduite')).toBeInTheDocument();
  expect(screen.getByText(/enregistré le 20 août 2026/)).toBeInTheDocument();
});

test('déclarer un changement envoie la date d’effet saisie, pas celle du jour', async () => {
  api.getTariffRecipes.mockResolvedValue({ recipes: [], invalid: [] });
  api.getTariffChangeJournal.mockResolvedValue({ events: [] });
  api.addTariffChangeEvent.mockResolvedValue({ event: { id: 3 } });
  renderPage();

  await waitFor(() => expect(screen.getByText("Aucun changement enregistré pour l'instant.")).toBeInTheDocument());
  // PageActionBar enveloppe l'IconButton dans un <span> (Tooltip) : viser le bouton, pas le libellé,
  // sinon le clic tombe sur le wrapper qui ne porte pas le handler.
  fireEvent.click(screen.getByRole('button', { name: 'Déclarer un changement tarifaire' }));

  const dateField = await screen.findByLabelText("Date et heure d'effet");
  fireEvent.change(dateField, { target: { value: '2026-08-14T11:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(api.addTariffChangeEvent).toHaveBeenCalledWith({
    propertyId: 1, kind: 'platforms', occurredAt: '2026-08-14 11:00', note: '',
  }));
});

test('le journal vide propose sa propre explication', async () => {
  api.getTariffRecipes.mockResolvedValue({ recipes: [], invalid: [] });
  api.getTariffChangeJournal.mockResolvedValue({ events: [] });
  renderPage();
  await waitFor(() => expect(screen.getByText("Aucun changement enregistré pour l'instant.")).toBeInTheDocument());
});
