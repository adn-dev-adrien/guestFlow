import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import TariffRecipeCard from '../TariffRecipeCard';
import api from '../../../api';

// specs/tariff-recipes/spec.md §3.2 rules 7-8 — the card shows the active recipe + applied version,
// warns when the file moved on, previews the diff BEFORE writing, and offers a detach when the
// recipe vanished.

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

const RECIPES = {
  recipes: [
    { id: 'aventura-lodge-2026', label: 'Aventura Lodge 2026', version: '1.0.0', source: 'bundled', overridesBundled: false, usedByProperties: [] },
  ],
};

const PREVIEW = {
  recipe: { id: 'aventura-lodge-2026', version: '1.0.0', label: 'Aventura Lodge 2026' },
  horizon: { fromYear: 2026, toYear: 2027 },
  seasons: [
    { seasonKey: 'low', label: 'Basse saison', action: 'create', fieldChanges: [], rangesAdded: [{ startDate: '2026-01-01', endDate: '2026-04-03' }], rangesRemoved: [] },
    { seasonKey: 'old', label: 'Ancienne saison', action: 'remove', fieldChanges: [], rangesAdded: [], rangesRemoved: [{ startDate: '2026-06-01', endDate: '2026-06-30' }] },
    { seasonKey: 'mid', label: 'Moyenne saison', action: 'unchanged', fieldChanges: [], rangesAdded: [], rangesRemoved: [] },
  ],
  closures: { added: [{ label: 'Fermeture hivernale', startDate: '2026-10-15', endDate: '2027-03-31' }], kept: [] },
  warnings: [],
  blocking: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getTariffRecipe.mockResolvedValue({ recipe: null });
});

test('the particularities panel states the recipe deal in plain French', async () => {
  api.getTariffRecipes.mockResolvedValue(RECIPES);
  api.getTariffRecipe.mockResolvedValue({
    recipe: {
      id: 'aventura-lodge-2026', horizonYears: 2,
      lengthOfStayDiscounts: [{ nights: 2, discountPct: 24 }, { nights: 7, discountPct: 45 }],
      extraGuest: { appliesAbove: 2, unit: 'per_night', followsDiscount: true },
      seasons: [{ label: 'Basse saison', pricePerNight: 179, netTargetPerNight: 160, extraGuestPrice: 27, minNights: 1, maxNights: 7, changeover: null }],
      calendar: { modifiers: [{ type: 'public_holiday_bridge', amount: 1, minNights: 'block' }] },
      closures: [{ label: 'Fermeture hivernale', from: '10-15', to: '03-31' }],
    },
  });
  render(
    <TariffRecipeCard
      propertyId={1} activeRecipeId="aventura-lodge-2026" appliedVersion="1.0.0"
      rateInclusions={[
        { optionId: 1, title: 'Ménage', unitPrice: 30, offered: 1, freeUnits: 0 },
        { optionId: 2, title: 'Petit déjeuner', unitPrice: 10, offered: 0, freeUnits: 2 },
      ]}
    />
  );
  // The degressive extra-guest rule and the direct-only free breakfasts both surface here.
  expect(await screen.findByText(/soumise à la même dégressivité/)).toBeInTheDocument();
  expect(screen.getByText(/les 2 premiers offerts/)).toBeInTheDocument();
  // Lodgify is the channel most direct bookings actually carry — the panel must say so, or the
  // operator reads « direct » as « created by hand in GuestFlow » and thinks the pack never fires.
  expect(screen.getByText(/réservations directes et Lodgify uniquement/)).toBeInTheDocument();
  expect(screen.getByText(/2 nuits −24 %/)).toBeInTheDocument();
  expect(screen.getByText(/de 1 à 7 nuits/)).toBeInTheDocument();
  expect(screen.getByText(/minimum de séjour égal à la longueur du pont/)).toBeInTheDocument();
  expect(screen.getByText(/Fermeture hivernale : 15\/10 → 31\/03/)).toBeInTheDocument();
});

test('shows the applied version and the recipe select', async () => {
  api.getTariffRecipes.mockResolvedValue(RECIPES);
  render(<TariffRecipeCard propertyId={1} activeRecipeId="aventura-lodge-2026" appliedVersion="1.0.0" />);
  await waitFor(() => expect(api.getTariffRecipes).toHaveBeenCalled());
  expect(screen.getByText('v1.0.0 appliquée')).toBeInTheDocument();
  expect(screen.getByText('Appliquer la recette…')).toBeInTheDocument();
});

test('warns when the recipe file has a newer version than the applied one', async () => {
  api.getTariffRecipes.mockResolvedValue({
    recipes: [{ ...RECIPES.recipes[0], version: '1.1.0' }],
  });
  render(<TariffRecipeCard propertyId={1} activeRecipeId="aventura-lodge-2026" appliedVersion="1.0.0" />);
  await waitFor(() => expect(api.getTariffRecipes).toHaveBeenCalled());
  expect(screen.getByText(/Version 1.1.0 disponible/)).toBeInTheDocument();
});

test('preview lists created / removed seasons and closures, and applies only on confirm', async () => {
  api.getTariffRecipes.mockResolvedValue(RECIPES);
  api.previewTariffRecipe.mockResolvedValue(PREVIEW);
  const onApplied = vi.fn();
  render(<TariffRecipeCard propertyId={1} activeRecipeId="aventura-lodge-2026" appliedVersion="1.0.0" onApplied={onApplied} />);
  await waitFor(() => expect(api.getTariffRecipes).toHaveBeenCalled());

  fireEvent.click(screen.getByText('Appliquer la recette…'));
  await waitFor(() => expect(api.previewTariffRecipe).toHaveBeenCalledWith(1, 'aventura-lodge-2026'));
  expect(screen.getByText('Aperçu des modifications')).toBeInTheDocument();
  expect(screen.getByText('sera créée')).toBeInTheDocument();
  expect(screen.getByText('sera supprimée')).toBeInTheDocument();
  expect(screen.queryByText('inchangée')).not.toBeInTheDocument(); // unchanged rows are hidden
  expect(screen.getByText(/Fermeture hivernale/)).toBeInTheDocument();
  // Nothing written yet.
  expect(api.applyTariffRecipe).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }));
  await waitFor(() => expect(api.applyTariffRecipe).toHaveBeenCalledWith(1, 'aventura-lodge-2026'));
  await waitFor(() => expect(onApplied).toHaveBeenCalled());
});

test('a blocking preview shows the warning and disables Appliquer', async () => {
  api.getTariffRecipes.mockResolvedValue(RECIPES);
  api.previewTariffRecipe.mockResolvedValue({
    ...PREVIEW, blocking: true, warnings: ['La plage 2026-06-01 → 2026-06-30 chevauche la saison manuelle « Peinte ».'],
  });
  render(<TariffRecipeCard propertyId={1} activeRecipeId="aventura-lodge-2026" appliedVersion="1.0.0" />);
  await waitFor(() => expect(api.getTariffRecipes).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Appliquer la recette…'));
  await waitFor(() => expect(screen.getByText(/chevauche la saison manuelle/)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Appliquer' })).toBeDisabled();
});

test('a vanished recipe offers a detach', async () => {
  api.getTariffRecipes.mockResolvedValue({ recipes: [] });
  const onApplied = vi.fn();
  render(<TariffRecipeCard propertyId={1} activeRecipeId="gone-recipe" appliedVersion="1.0.0" onApplied={onApplied} />);
  await waitFor(() => expect(screen.getByText(/Recette introuvable/)).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Détacher' }));
  await waitFor(() => expect(api.detachTariffRecipe).toHaveBeenCalledWith(1));
  await waitFor(() => expect(onApplied).toHaveBeenCalled());
});
