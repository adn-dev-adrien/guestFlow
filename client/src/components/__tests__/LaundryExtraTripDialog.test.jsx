import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const previewLaundryExtraTrip = vi.fn();
vi.mock('../../api', () => ({ default: { previewLaundryExtraTrip: (...args) => previewLaundryExtraTrip(...args) } }));

import LaundryExtraTripDialog from '../LaundryExtraTripDialog';

// specs/laundry-extra-trip.md §3.5 rule 18 + §6 — the create / edit dialog of an extra trip. The
// preview is a server call (mocked here); the dialog only renders it and sends back the choice.

const BLOCK = (over = {}) => ({
  singleBeds: 0, doubleBeds: 0, babyBeds: 0, largeTowels: 0, mediumTowels: 0, smallTowels: 0, bathMats: 0, ...over,
});

beforeEach(() => {
  previewLaundryExtraTrip.mockReset();
});

test('create mode: renders the server preview lines for the chosen date', async () => {
  previewLaundryExtraTrip.mockResolvedValue({
    date: '2026-08-20',
    dropOff: BLOCK({ doubleBeds: 4, singleBeds: 2, largeTowels: 8 }),
    atLaundry: BLOCK({ doubleBeds: 6 }),
  });
  render(<LaundryExtraTripDialog open mode="create" date="2026-08-20" onSave={() => {}} onClose={() => {}} />);
  await waitFor(() => expect(previewLaundryExtraTrip).toHaveBeenCalledWith('2026-08-20'));
  expect(await screen.findByText(/Draps : 4 doubles · 2 simples · Serviettes : 8 grandes/)).toBeInTheDocument();
  expect(screen.getByText(/Draps : 6 doubles/)).toBeInTheDocument();
  expect(screen.getByLabelText('Date du voyage')).toBeInTheDocument();
});

test('« Tout récupérer » (default) saves pickUpAll: true for the date', async () => {
  previewLaundryExtraTrip.mockResolvedValue({ date: '2026-08-20', dropOff: BLOCK(), atLaundry: BLOCK({ singleBeds: 3 }) });
  const onSave = vi.fn();
  render(<LaundryExtraTripDialog open mode="create" date="2026-08-20" onSave={onSave} onClose={() => {}} />);
  const save = screen.getByRole('button', { name: 'Enregistrer' });
  await waitFor(() => expect(save).not.toBeDisabled());
  fireEvent.click(save);
  expect(onSave).toHaveBeenCalledWith('2026-08-20', expect.objectContaining({ pickUpAll: true }));
});

test('« Récupérer une partie » reveals one capped field per type at the laundry, prefilled with the pool; Save sends the counts', async () => {
  previewLaundryExtraTrip.mockResolvedValue({
    date: '2026-08-20', dropOff: BLOCK(), atLaundry: BLOCK({ singleBeds: 3, largeTowels: 2 }),
  });
  const onSave = vi.fn();
  render(<LaundryExtraTripDialog open mode="create" date="2026-08-20" onSave={onSave} onClose={() => {}} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).not.toBeDisabled());
  fireEvent.click(screen.getByLabelText('Récupérer une partie'));
  // Only the types present in the pool are shown (Simple + Grande), prefilled with the pool value.
  expect(screen.getByText('(3 à la blanchisserie)')).toBeInTheDocument();
  expect(screen.getByText('(2 à la blanchisserie)')).toBeInTheDocument();
  expect(screen.queryByText('Double')).toBeNull();
  // The « + » of the first field is disabled at the cap; « − » brings Simple to 2.
  const increments = screen.getAllByRole('button', { name: 'Augmenter' });
  expect(increments[0]).toBeDisabled();
  fireEvent.click(screen.getAllByRole('button', { name: 'Diminuer' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(onSave).toHaveBeenCalledWith('2026-08-20', {
    pickUpAll: false,
    pickUp: BLOCK({ singleBeds: 2, largeTowels: 2 }),
  });
});

test('edit mode: the date is fixed, the stored partial counts prefill (capped by the pool)', async () => {
  previewLaundryExtraTrip.mockResolvedValue({ date: '2026-08-20', dropOff: BLOCK(), atLaundry: BLOCK({ singleBeds: 2 }) });
  const onSave = vi.fn();
  render(
    <LaundryExtraTripDialog
      open mode="edit" date="2026-08-20"
      current={{ date: '2026-08-20', pickUpAll: false, pickUp: BLOCK({ singleBeds: 5 }) }}
      onSave={onSave} onClose={() => {}}
    />,
  );
  expect(screen.queryByLabelText('Date du voyage')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).not.toBeDisabled());
  // Partial mode pre-selected from the stored trip; the stored 5 is capped at the pool (2).
  expect(screen.getByLabelText('Récupérer une partie')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(onSave).toHaveBeenCalledWith('2026-08-20', { pickUpAll: false, pickUp: BLOCK({ singleBeds: 2 }) });
});

test('a laundry-day date: inline error from the server code, Save disabled', async () => {
  const err = new Error('Ce jour est déjà un jour de blanchisserie.');
  err.code = 'EXTRA_TRIP_ON_LAUNDRY_DAY';
  previewLaundryExtraTrip.mockRejectedValue(err);
  render(<LaundryExtraTripDialog open mode="create" date="2026-08-18" onSave={() => {}} onClose={() => {}} />);
  expect(await screen.findByText('Ce jour est déjà un jour de blanchisserie.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  expect(screen.getByLabelText('Récupérer une partie')).toBeDisabled();
});

test('an empty pool disables « Récupérer une partie »; Annuler calls onClose', async () => {
  previewLaundryExtraTrip.mockResolvedValue({ date: '2026-08-20', dropOff: BLOCK({ singleBeds: 1 }), atLaundry: BLOCK() });
  const onClose = vi.fn();
  render(<LaundryExtraTripDialog open mode="create" date="2026-08-20" onSave={() => {}} onClose={onClose} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).not.toBeDisabled());
  expect(screen.getByLabelText('Récupérer une partie')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(onClose).toHaveBeenCalled();
});
