// specs/outside-booking-sas.md §6 (responsive) and CLAUDE.md « Responsive design » — on a phone the mini SAS is full screen, the « Reste à payer » is kept at the top, the primary action is
// the last one and full width under the thumb, every touch target is at least 44 px; read-only for a caller the server does not let write, with the server's reason.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import ResourceArrivalDialog from '../ResourceArrivalDialog';
import api from '../../../api';
import { visitPayload } from './arrivalVisitFixtures';

vi.mock('../../../api', () => ({
  default: {
    getResourceVisit: vi.fn(),
    quoteResourceVisit: vi.fn(),
    commitResourceVisit: vi.fn(),
    searchResourceVisitArticles: vi.fn(),
    issueResourceBookingInvoice: vi.fn(),
    attachResourceBookingInvoice: vi.fn(),
  },
}));
vi.mock('../../../hooks/usePostalCodeCities', () => ({ default: () => [] }));

const phone = () => {
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query), media: query,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    onchange: null, dispatchEvent: () => false,
  });
};
afterEach(() => { delete window.matchMedia; });
beforeEach(() => { vi.clearAllMocks(); api.getResourceVisit.mockResolvedValue(visitPayload()); });

test('on a phone: full screen, the reste kept at the top, « Valider l\'arrivée » last and full width, 44 px targets', async () => {
  phone();
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  const dialog = await screen.findByRole('dialog');
  expect(dialog.className).toMatch(/MuiDialog-paperFullScreen/);
  expect(screen.getByTestId('sticky-remaining')).toHaveTextContent('120,00 €');
  const buttons = Array.from(dialog.querySelectorAll('button')).filter((b) => !b.closest('.MuiDialogContent-root'));
  const last = buttons[buttons.length - 1];
  expect(last).toHaveTextContent('Valider l’arrivée');
  const sx = getComputedStyle(last);
  expect(sx.minHeight).toBe('44px');
  const plus = screen.getByRole('button', { name: 'Plus 15 minutes' });
  expect(getComputedStyle(plus).minHeight).toBe('44px');
  expect(getComputedStyle(await screen.findByRole('button', { name: /Bière locale/ })).minHeight).toBe('44px');
});

test('a centred dialog from sm up, with no sticky bar needed', async () => {
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect((await screen.findByRole('dialog')).className).not.toMatch(/MuiDialog-paperFullScreen/);
});

test('a caller the server does not let write sees the visit read-only with the server\'s reason, and can only close', async () => {
  api.getResourceVisit.mockResolvedValue(visitPayload({ access: { writable: false, reason: 'Arrivée : le jour de la séance seulement.', reception: true } }));
  render(<ResourceArrivalDialog open bookingId={5} onClose={() => {}} onDone={() => {}} />);
  expect(await screen.findByText('Arrivée : le jour de la séance seulement.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Plus 15 minutes' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Autre article' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Encaisser' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Fermer' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Valider l’arrivée' })).toBeNull();
});
