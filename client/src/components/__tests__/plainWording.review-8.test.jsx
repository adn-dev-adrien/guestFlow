// specs/ds-components.md rule 25 — review #8 (n-2, n-3, n-4, m-5): the screens speak short, impersonal
// French — no « tu », no « nous », no English label, no internal mechanics, accents where they belong.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getTranslationSummary: vi.fn().mockResolvedValue({ total: 76, missing: { de: 75, en: 56 }, stale: {}, languages: ['de', 'en'] }),
    getCancellationCompensations: vi.fn().mockResolvedValue({ pending: [], received: [], totals: { pendingExpected: 0, receivedInMonth: 0 } }),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'] } }) }));

import CollectionStatusCell from '../CollectionStatusCell';
import ReservationCard from '../ReservationCard';
import DepartureMiniRow from '../DepartureMiniRow';
import TranslationCatalogueCard from '../TranslationCatalogueCard';
import CompensationsPage from '../../pages/CompensationsPage';

const wrap = (node) => render(
  <MemoryRouter><ThemeProvider theme={theme}><DialogProvider>{node}</DialogProvider></ThemeProvider></MemoryRouter>,
);

test('rule 25 — an unpaid part reads « dû », not « NON »', () => {
  render(<CollectionStatusCell collection={{
    arrival: { alert: false, settled: false, amountDue: 0, parts: [{ key: 'balance', label: 'Solde', state: 'pending' }] },
  }} />);
  expect(screen.getByText('Solde dû')).toBeInTheDocument();
  expect(screen.queryByText(/NON/)).not.toBeInTheDocument();
});

test('rule 25 — the planning launchers are « Accueil » and « Départ », not « Check-in (SAS arrivée) »', () => {
  render(<ReservationCard reservation={{ id: 1, firstName: 'A', lastName: 'B', options: [], resources: [] }} onToggleReady={() => {}} onOpenSas={() => {}} />);
  expect(screen.getByRole('button', { name: 'Accueil' })).toBeInTheDocument();
  render(<DepartureMiniRow reservation={{ id: 2, firstName: 'C', lastName: 'D' }} onToggleDone={() => {}} onOpenSas={() => {}} />);
  expect(screen.getByRole('button', { name: 'Départ' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /SAS|Check-/ })).not.toBeInTheDocument();
});

test('rule 25 — the translations card says what to do without « tu »', async () => {
  wrap(<TranslationCatalogueCard />);
  expect(await screen.findByText(/Traductions : télécharger le fichier, remplir les colonnes, le renvoyer\./)).toBeInTheDocument();
  expect(screen.queryByText(/télécharge-le|ajoute simplement/)).not.toBeInTheDocument();
});

test('rule 25 — the compensations page is titled « Indemnités » and explains itself without « nous »', async () => {
  wrap(<CompensationsPage />);
  expect(await screen.findByRole('heading', { name: 'Indemnités' })).toBeInTheDocument();
  expect(await screen.findByText(/l'acompte conservé faute de règlement/)).toBeInTheDocument();
  expect(screen.queryByText(/nous annulons/)).not.toBeInTheDocument();
});
