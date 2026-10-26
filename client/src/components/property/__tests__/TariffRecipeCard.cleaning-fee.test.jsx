// specs/tariff-recipe-platform-cleaning-fee.md rule 11 — a cleaning-fee change is a change: the apply
// dialog lists it and never says « Rien à modifier » while one differs.
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import TariffRecipeCard from '../TariffRecipeCard';
import api from '../../../api';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getTariffRecipes: vi.fn(),
    getTariffRecipe: vi.fn().mockResolvedValue({ recipe: null }),
    previewTariffRecipe: vi.fn(),
    applyTariffRecipe: vi.fn().mockResolvedValue({ applied: true }),
    detachTariffRecipe: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

const RECIPES = { recipes: [{ id: 'gite-2027', label: 'Gîte 2027', version: '3.6.0', source: 'bundled', overridesBundled: false, usedByProperties: [] }] };
const previewWith = (cleaningFeeChanges) => ({
  recipe: { id: 'gite-2027', version: '3.6.0', label: 'Gîte 2027' },
  horizon: { fromYear: 2026, toYear: 2027 },
  seasons: [{ seasonKey: 'low', label: 'Très basse', action: 'unchanged', fieldChanges: [], rangesAdded: [], rangesRemoved: [] }],
  closures: { added: [], kept: [] },
  cleaningFeeChanges,
  warnings: [],
  blocking: false,
});

async function openPreview(preview) {
  api.getTariffRecipes.mockResolvedValue(RECIPES);
  api.previewTariffRecipe.mockResolvedValue(preview);
  render(<TariffRecipeCard propertyId={1} activeRecipeId="gite-2027" appliedVersion="3.5.0" />);
  await waitFor(() => expect(api.getTariffRecipes).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Appliquer la recette…'));
  await screen.findByText('Aperçu des modifications');
}

test('seasons unchanged but the Airbnb fee moves: the change is listed, no « Rien à modifier »', async () => {
  await openPreview(previewWith([{ platform: 'Airbnb', from: null, to: 102.92 }]));
  expect(screen.getByText(/Airbnb : frais de ménage — → 102,92 € net/)).toBeInTheDocument();
  expect(screen.queryByText(/Rien à modifier/)).toBeNull();
});

test('nothing moves at all: « Rien à modifier » as before', async () => {
  await openPreview(previewWith([]));
  expect(screen.getByText(/Rien à modifier/)).toBeInTheDocument();
});
