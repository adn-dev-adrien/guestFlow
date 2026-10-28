// specs/settings-input-guards.md rules 32-34 — every account sits in the one « Comptes » card, in labelled groups.
import { vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../../components/DialogProvider';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getPlatformAccounts: vi.fn(), savePlatformAccounts: vi.fn(), refreshPlatformAccounts: vi.fn() },
}));
vi.mock('../../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'] } }) }));

import api from '../../../api';
import PlatformAccountsPage from '../PlatformAccountsPage';
import { accountGroupsFor } from '../accountGroups';

const row = (key, value = '70600000') => ({ key, value, default: value });
const FULL_PLAN = [
  'accommodationAccount', 'complementaryAccount', 'activitiesAccount', 'vat20Account', 'vat10Account', 'touristTaxAccount',
  'commissionVatAccount', 'discountAccount', 'tipAccount',
].map((k) => row(k)).concat(row('journalCode', 'VT'));
const GET = (plan) => ({
  defaultAccount: '622600', vatRateCommission: 20, cancellationCompensationAccount: '75880000', vatRateCancellationCompensation: 0, plan, platforms: [],
});
const renderPage = () => render(<MemoryRouter><DialogProvider><PlatformAccountsPage /></DialogProvider></MemoryRouter>);
const cardOf = async () => (await screen.findByText('Comptes')).closest('.MuiCard-root');

test('rule 32: three labelled groups then the journal, in one « Comptes » card', async () => {
  api.getPlatformAccounts.mockResolvedValue(GET(FULL_PLAN));
  renderPage();
  const card = await cardOf();
  const headings = within(card).getAllByText(/^(Ventes|Taxes|Commissions et produits divers|Journal)$/).map((n) => n.textContent);
  expect(headings).toEqual(['Ventes', 'Taxes', 'Commissions et produits divers', 'Journal']);
  expect(screen.queryByText('Compte par défaut')).toBeNull();
  expect(screen.queryByText("Indemnités d'annulation", { selector: '.MuiTypography-sectionHeader, h6, h5, h4' })).toBeNull();
});

test('rule 32: the default commission and the indemnity accounts sit inside « Comptes », the indemnity VAT right under', async () => {
  api.getPlatformAccounts.mockResolvedValue(GET(FULL_PLAN));
  renderPage();
  const card = await cardOf();
  const fields = within(card).getAllByRole('textbox').map((n) => n.closest('.MuiTextField-root').querySelector('label').textContent);
  expect(fields).toEqual([
    'Hébergement', 'Prestations complémentaires', 'Activités', 'Rabais accordés',
    'TVA collectée 20 %', 'TVA collectée 10 %', 'Taxe de séjour', 'TVA déductible (commissions)',
    'Commission par défaut', "Indemnités d'annulation", 'TVA sur indemnités (%)', 'Pourboires',
    'Code journal des ventes',
  ]);
  expect(within(card).getByLabelText('Commission par défaut')).toHaveValue('622600');
});

test('rule 34: the helpers keep their substance, shorter', async () => {
  api.getPlatformAccounts.mockResolvedValue(GET(FULL_PLAN));
  renderPage();
  await cardOf();
  expect(screen.getByText('Pour les plateformes sans compte propre.')).toBeInTheDocument();
  expect(screen.getByText("Crédité quand une plateforme indemnise une annulation.")).toBeInTheDocument();
});

test('rule 33: with no plan rows « Comptes » still shows the two older accounts', async () => {
  api.getPlatformAccounts.mockResolvedValue(GET([]));
  renderPage();
  const card = await cardOf();
  expect(within(card).getByLabelText('Commission par défaut')).toBeInTheDocument();
  expect(within(card).getByLabelText("Indemnités d'annulation")).toBeInTheDocument();
  expect(within(card).queryByText('Ventes')).toBeNull();
});

test('rule 33: a plan row the page does not know yet goes at the end of « Ventes » with its key as label', () => {
  const groups = accountGroupsFor([row('accommodationAccount'), row('penaltyAccount', '75800000')]);
  const sales = groups[0];
  expect(sales.label).toBe('Ventes');
  expect(sales.fields.map((f) => f.label)).toEqual(['Hébergement', 'penaltyAccount']);
  expect(sales.fields[1].helper).toBe('Par défaut : 75800000');
});
