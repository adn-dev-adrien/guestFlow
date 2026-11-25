// specs/site-outside-resource-booking.md rules 4, 26 — the party declared at booking shows on the fiche of the passage, in the session block, and is corrected there: saved when the field is
// left, empty meaning none, a refusal of the server shown under the field.
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router';
import OutsideBookingPage from '../OutsideBookingPage';
import api from '../../../api';

vi.mock('../../../api', () => ({ default: { getResourceBookingFiche: vi.fn(), setResourceBookingPeople: vi.fn() } }));
vi.mock('../../../components/DialogProvider', () => ({ useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }), useAppDialogs: () => ({ confirm: vi.fn() }) }));
vi.mock('../ResourceArrivalDialog', () => ({ default: () => null }));

const ficheOf = (people) => ({
  booking: { id: 12, resourceName: 'Bain nordique', date: '2099-03-04', startTime: '18:00', endTime: '19:00', people, notes: '' },
  client: { name: 'Claire Martin', email: null, phone: null, clientId: null },
  sessions: [{ date: '2099-03-04', start: '18:00', end: '19:00', resourceName: 'Bain nordique' }],
  lines: [], totals: null, payments: [], refunds: [], terms: [], arrival: { state: 'expected', at: null }, history: [],
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/passages/12']}>
    <Routes><Route path="/passages/:bookingId" element={<OutsideBookingPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => { vi.clearAllMocks(); });

test('the people of the booking are in the session block; leaving the field saves a change and reloads the fiche', async () => {
  api.getResourceBookingFiche.mockResolvedValueOnce({ fiche: ficheOf(3) }).mockResolvedValue({ fiche: ficheOf(5) });
  api.setResourceBookingPeople.mockResolvedValue({ ok: true, people: 5 });
  renderPage();
  const field = await screen.findByLabelText('Personnes');
  expect(field).toHaveValue('3');
  fireEvent.change(field, { target: { value: '5' } });
  fireEvent.blur(field);
  await waitFor(() => expect(api.setResourceBookingPeople).toHaveBeenCalledWith(12, '5'));
  await waitFor(() => expect(api.getResourceBookingFiche).toHaveBeenCalledTimes(2));
  expect(await screen.findByLabelText('Personnes')).toHaveValue('5');
});

test('an unchanged field saves nothing; an emptied one sends none; a booking with no people shows an empty field', async () => {
  api.getResourceBookingFiche.mockResolvedValue({ fiche: ficheOf(3) });
  api.setResourceBookingPeople.mockResolvedValue({ ok: true, people: null });
  renderPage();
  const field = await screen.findByLabelText('Personnes');
  fireEvent.blur(field);
  expect(api.setResourceBookingPeople).not.toHaveBeenCalled();
  fireEvent.change(field, { target: { value: '' } });
  fireEvent.blur(field);
  await waitFor(() => expect(api.setResourceBookingPeople).toHaveBeenCalledWith(12, null));
});

test('a booking made in GuestFlow, with no people declared, shows an empty field', async () => {
  api.getResourceBookingFiche.mockResolvedValue({ fiche: ficheOf(null) });
  renderPage();
  expect(await screen.findByLabelText('Personnes')).toHaveValue('');
});

test('the refusal of the server is shown under the field, and the typed value stays', async () => {
  api.getResourceBookingFiche.mockResolvedValue({ fiche: ficheOf(3) });
  api.setResourceBookingPeople.mockRejectedValue(new Error('Nombre de personnes invalide.'));
  renderPage();
  const field = await screen.findByLabelText('Personnes');
  fireEvent.change(field, { target: { value: '0' } });
  fireEvent.blur(field);
  expect(await screen.findByText('Nombre de personnes invalide.')).toBeInTheDocument();
  expect(field).toHaveValue('0');
});
