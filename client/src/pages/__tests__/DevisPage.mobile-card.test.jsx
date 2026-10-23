// DevisPage mobile card — specs/devis-list-mobile-card.md rules 1-4: logement and stay on their own
// lines, one origin marker, destructive actions behind « ⋯ ».
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getDevis: vi.fn(), deleteDevis: vi.fn(), getDevisPdfBlob: vi.fn(), convertDevisToReservation: vi.fn() },
}));

import api from '../../api';
import DevisPage from '../DevisPage';

const DEVIS = [
  {
    id: 1, devisNumber: '2026-10-014', status: 'draft', firstName: 'Camille', lastName: 'Martin',
    propertyName: 'La Granja', stayLabel: '10 → 13 mai 2027 · 3 nuits', totalTtc: 1254.4,
    requestOrigin: 'public', originLabel: 'Réseaux sociaux · Instagram', originDetail: null,
  },
  {
    id: 2, devisNumber: '2026-10-011', status: 'sent', firstName: 'Jean', lastName: 'Repetto',
    propertyName: "L'Estiva", stayLabel: '24 → 31 juil. 2027 · 7 nuits', totalTtc: 3480,
    requestOrigin: 'public', originLabel: 'Origine inconnue', originDetail: null,
  },
];

function mockMobile() {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: /max-width/.test(query),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <DialogProvider><DevisPage /></DialogProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockMobile();
  api.getDevis.mockResolvedValue(DEVIS);
});

// The whole card is what the tests look into: the closest ancestor holding the footer actions.
const cardOf = async (guest) => {
  const pdf = (await screen.findByText(guest)).closest('[role="button"]').parentElement;
  return pdf;
};

test('the logement and the stay are separate elements, the stay read from the server label', async () => {
  renderPage();
  const first = await cardOf('Camille Martin');
  const logement = within(first).getByText('La Granja');
  const stay = within(first).getByText('10 → 13 mai 2027 · 3 nuits');
  expect(logement).not.toBe(stay);
  expect(logement.parentElement).not.toBe(stay.parentElement);
  expect(within(first).getByText('Camille Martin')).toBeInTheDocument();
  expect(within(first).getByText(/1\s?254,40/)).toBeInTheDocument();
});

test('a website request shows one origin marker: the known channel, else « Site internet »', async () => {
  renderPage();
  const first = await cardOf('Camille Martin');
  expect(within(first).getByText('Réseaux sociaux · Instagram')).toBeInTheDocument();
  expect(within(first).queryByText('Site internet')).toBeNull();

  const second = await cardOf('Jean Repetto');
  expect(within(second).getByText('Site internet')).toBeInTheDocument();
  expect(within(second).queryByText('Origine inconnue')).toBeNull();
});

test('« Supprimer » is only reachable through the « ⋯ » menu, and still asks for confirmation', async () => {
  renderPage();
  const first = await cardOf('Camille Martin');
  expect(within(first).queryByRole('button', { name: 'Supprimer' })).toBeNull();
  expect(within(first).getByRole('button', { name: 'Télécharger le PDF' })).toBeInTheDocument();

  await userEvent.click(within(first).getByRole('button', { name: "Plus d'actions" }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Supprimer' }));

  expect(await screen.findByText(/Supprimer le devis 2026-10-014/)).toBeInTheDocument();
  expect(api.deleteDevis).not.toHaveBeenCalled();
});

test('the PDF and « ⋯ » controls are never nested inside the card\'s own button (no nested interactive)', async () => {
  renderPage();
  const guest = await screen.findByText('Camille Martin');
  const cardButton = guest.closest('[role="button"]');
  expect(within(cardButton).queryByRole('button', { name: 'Télécharger le PDF' })).toBeNull();
  expect(within(cardButton).queryByRole('button', { name: "Plus d'actions" })).toBeNull();
  expect(within(cardButton.parentElement).getByRole('button', { name: 'Télécharger le PDF' })).toBeInTheDocument();
});

test('the PDF button downloads without opening the devis behind it', async () => {
  renderPage();
  const first = await cardOf('Camille Martin');
  await userEvent.click(within(first).getByRole('button', { name: 'Télécharger le PDF' }));
  expect(api.getDevisPdfBlob).toHaveBeenCalledTimes(1);
});
