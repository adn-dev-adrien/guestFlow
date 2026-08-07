import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ReservationFormProvider } from '../ReservationFormContext';
import ExtrasSection from '../ExtrasSection';
import { makeMockContext } from '../mockReservationForm';

// specs/option-categories.md §3 rules 7-14 — collapsible option categories on the fiche.
//
// The rule that matters most: an option ENABLED on the reservation renders outside the collapse
// ("pinned"), so folding a category can never hide a line the guest is billed for. Everything else
// (membership, order) is decided server-side and arrives in `propertyOptionGroups`.

const MENAGE = { id: 1, title: 'Ménage', price: 80, priceType: 'per_stay' };
const CHAMPAGNE = { id: 10, title: 'Champagne 75cl', price: 40, priceType: 'per_stay', category: 'Boissons' };
const JUS = { id: 11, title: 'Jus de pomme 1L', price: 5, priceType: 'per_stay', category: 'Boissons' };
const MAD_MAX = { id: 12, title: 'Mad Max 75cl', price: 7.5, priceType: 'per_stay', category: 'Boissons' };
const PLANCHE = { id: 20, title: 'Planche S', price: 17, priceType: 'per_stay', category: 'Restauration' };

function renderExtras({ groups = null, selectedOptions = [], options = null } = {}) {
  const allOptions = options || [MENAGE, CHAMPAGNE, JUS, MAD_MAX, PLANCHE];
  const ctx = makeMockContext({
    propertyOptions: allOptions,
    propertyOptionGroups: groups,
    displayableResources: [],
    form: { selectedOptions, customOptions: [], selectedResources: [] },
  });
  ctx.setOptionInComplement = () => {};
  ctx.setResourceInComplement = () => {};
  ctx.setAutoOptionInComplement = () => {};
  render(
    <ReservationFormProvider value={ctx}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
  return ctx;
}

// The shape the server ships (utils/optionGrouping.js), for a catalogue of 5 options.
const GROUPS = {
  ungrouped: [MENAGE],
  groups: [
    { category: 'Boissons', options: [CHAMPAGNE, JUS, MAD_MAX] },
    { category: 'Restauration', options: [PLANCHE] },
  ],
};

test('ungrouped options render outside any section; categories render as headers', () => {
  renderExtras({ groups: GROUPS });
  expect(screen.getByText('Ménage')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Catégorie Boissons/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Catégorie Restauration/ })).toBeInTheDocument();
});

test('categories are collapsed on load — their options are not rendered', () => {
  renderExtras({ groups: GROUPS });
  expect(screen.queryByText('Champagne 75cl')).not.toBeInTheDocument();
  expect(screen.queryByText('Planche S')).not.toBeInTheDocument();
  // The affordance says how many are hidden.
  expect(screen.getByText('Voir les 3 options')).toBeInTheDocument();
  expect(screen.getByText('Voir les 1 option')).toBeInTheDocument();
});

test('expanding a category reveals its options', async () => {
  const user = userEvent.setup();
  renderExtras({ groups: GROUPS });
  await user.click(screen.getByRole('button', { name: /Catégorie Boissons/ }));
  expect(screen.getByText('Champagne 75cl')).toBeInTheDocument();
  expect(screen.getByText('Jus de pomme 1L')).toBeInTheDocument();
  // The other category stays closed.
  expect(screen.queryByText('Planche S')).not.toBeInTheDocument();
});

test('ENABLED options are pinned: visible while the category is still collapsed', () => {
  // The reopen-a-reservation case: 2 drinks were saved, the section is folded, and they must show.
  renderExtras({
    groups: GROUPS,
    selectedOptions: [
      { optionId: 10, quantity: 1, totalPrice: 40 },
      { optionId: 11, quantity: 3, totalPrice: 15 },
    ],
  });
  expect(screen.getByText('Champagne 75cl')).toBeInTheDocument();
  expect(screen.getByText('Jus de pomme 1L')).toBeInTheDocument();
  // ...while the untouched one stays folded away.
  expect(screen.queryByText('Mad Max 75cl')).not.toBeInTheDocument();
  expect(screen.getByText('Voir les 1 autre')).toBeInTheDocument();
});

test('the header chip counts the enabled options of the category', () => {
  renderExtras({
    groups: GROUPS,
    selectedOptions: [
      { optionId: 10, quantity: 1, totalPrice: 40 },
      { optionId: 11, quantity: 3, totalPrice: 15 },
    ],
  });
  const boissons = screen.getByRole('button', { name: /Catégorie Boissons/ });
  expect(within(boissons).getByText('2')).toBeInTheDocument();
  // Restauration has nothing enabled → no chip.
  const restauration = screen.getByRole('button', { name: /Catégorie Restauration/ });
  expect(within(restauration).queryByText('0')).not.toBeInTheDocument();
});

test('an option with quantity 0 is not treated as enabled', () => {
  renderExtras({ groups: GROUPS, selectedOptions: [{ optionId: 10, quantity: 0, totalPrice: 0 }] });
  expect(screen.queryByText('Champagne 75cl')).not.toBeInTheDocument();
  expect(screen.getByText('Voir les 3 options')).toBeInTheDocument();
});

test('when every option of a category is enabled, the toggle disappears', () => {
  renderExtras({
    groups: { ungrouped: [MENAGE], groups: [{ category: 'Restauration', options: [PLANCHE] }] },
    selectedOptions: [{ optionId: 20, quantity: 1, totalPrice: 17 }],
  });
  expect(screen.getByText('Planche S')).toBeInTheDocument();
  expect(screen.queryByText(/Voir les/)).not.toBeInTheDocument();
  expect(screen.queryByText('Réduire')).not.toBeInTheDocument();
});

test('a catalogue with no category renders exactly like before — no section header', () => {
  renderExtras({
    groups: { ungrouped: [MENAGE], groups: [] },
    options: [MENAGE],
  });
  expect(screen.getByText('Ménage')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Catégorie/ })).not.toBeInTheDocument();
});

test('a payload without optionGroups falls back to the flat list', () => {
  // Back-compat: a property detail cached before this feature shipped.
  renderExtras({ groups: null, options: [MENAGE, CHAMPAGNE] });
  expect(screen.getByText('Ménage')).toBeInTheDocument();
  expect(screen.getByText('Champagne 75cl')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Catégorie/ })).not.toBeInTheDocument();
});

test('an internal-only category yields no section (server filtered it out)', () => {
  // The server drops displayToClient=0 options BEFORE grouping, so an all-internal category
  // simply never appears in `groups` (rule 14). The fiche renders what it receives.
  renderExtras({
    groups: { ungrouped: [MENAGE], groups: [] },
    options: [MENAGE, { id: 30, title: 'Tapis de bain', price: 0, priceType: 'per_stay', category: 'Blanchisserie', displayToClient: 0 }],
  });
  expect(screen.queryByRole('button', { name: /Catégorie Blanchisserie/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Tapis de bain')).not.toBeInTheDocument();
});

// ---- rule 9bis: an alwaysVisible option is pinned even when nothing is selected ----

const PDJ = { id: 30, title: 'Petit déjeuner', price: 12, priceType: 'per_person', category: 'Restauration', alwaysVisible: 1 };

const GROUPS_WITH_PDJ = {
  ungrouped: [MENAGE],
  groups: [{ category: 'Restauration', options: [PDJ, PLANCHE] }],
};

test('an alwaysVisible option renders while its category is collapsed', () => {
  renderExtras({ groups: GROUPS_WITH_PDJ, options: [MENAGE, PDJ, PLANCHE] });
  expect(screen.getByText('Petit déjeuner')).toBeInTheDocument();
  // …while its unpinned sibling stays folded.
  expect(screen.queryByText('Planche S')).not.toBeInTheDocument();
  expect(screen.getByText('Voir les 1 autre')).toBeInTheDocument();
});

test('an alwaysVisible option that is NOT selected does not inflate the count chip', () => {
  renderExtras({ groups: GROUPS_WITH_PDJ, options: [MENAGE, PDJ, PLANCHE] });
  const restauration = screen.getByRole('button', { name: /Catégorie Restauration/ });
  expect(within(restauration).queryByText('1')).not.toBeInTheDocument();
  // The accessible name confirms zero selection.
  expect(screen.getByRole('button', { name: 'Catégorie Restauration' })).toBeInTheDocument();
});

test('selecting the alwaysVisible option lights the chip without moving the card', () => {
  renderExtras({
    groups: GROUPS_WITH_PDJ,
    options: [MENAGE, PDJ, PLANCHE],
    selectedOptions: [{ optionId: 30, quantity: 2, totalPrice: 24 }],
  });
  const restauration = screen.getByRole('button', { name: /Catégorie Restauration, 1 option sélectionnée/ });
  expect(within(restauration).getByText('1')).toBeInTheDocument();
  expect(screen.getByText('Petit déjeuner')).toBeInTheDocument();
});
