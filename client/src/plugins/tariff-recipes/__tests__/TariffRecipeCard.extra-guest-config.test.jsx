// specs/tariff-recipes/spec.md rule 64 (spec review 2026-10-27) — the supplement unit and included
// guests the recipe writes are listed in the apply preview, and count as a change.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

const RECIPES = { recipes: [{ id: 'aventura-lodge-2026', label: 'Lodge', version: '1.2.0', source: 'bundled', overridesBundled: false, usedByProperties: [] }] };
const previewWith = (extraGuestChanges) => ({
  recipe: { id: 'aventura-lodge-2026', version: '1.2.0', label: 'Lodge' },
  horizon: { fromYear: 2026, toYear: 2027 },
  seasons: [{ seasonKey: 'low', label: 'Basse saison', action: 'unchanged', fieldChanges: [], rangesAdded: [], rangesRemoved: [] }],
  closures: { added: [], kept: [] },
  cleaningFeeChanges: [],
  extraGuestChanges,
  warnings: [],
  blocking: false,
});

async function openPreview(preview) {
  api.getTariffRecipes.mockResolvedValue(RECIPES);
  api.previewTariffRecipe.mockResolvedValue(preview);
  render(<TariffRecipeCard propertyId={1} activeRecipeId="aventura-lodge-2026" appliedVersion="1.1.0" />);
  fireEvent.click(await screen.findByText('Appliquer la recette…'));
  await screen.findByText('Aperçu des modifications');
}

test('the supplement unit and included guests are listed; no « Rien à modifier »', async () => {
  await openPreview(previewWith([
    { field: 'extraGuestPriceUnit', label: 'Supplément voyageurs', from: 'par séjour', to: 'par nuit' },
    { field: 'basePriceIncludedGuests', label: 'Personnes incluses dans le prix', from: '0', to: '2' },
  ]));
  expect(screen.getByText('Supplément voyageurs : par séjour → par nuit')).toBeInTheDocument();
  expect(screen.getByText('Personnes incluses dans le prix : 0 → 2')).toBeInTheDocument();
  expect(screen.queryByText(/Rien à modifier/)).toBeNull();
});

test('a preview without the field (older server) still says « Rien à modifier »', async () => {
  const preview = previewWith([]);
  delete preview.extraGuestChanges;
  await openPreview(preview);
  expect(screen.getByText(/Rien à modifier/)).toBeInTheDocument();
});
