// specs/guest-email-texts-made-simple.md rules 27, 33, 34 — on the property page, the « Arrivée »
// block is saved by the page's own Enregistrer and guarded like every other field (rule 34); a fact
// the start assistant could not know shows empty and is sent only once answered (rule 27); the pool
// season is set on the Séjour tab (rule 33).

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const routerState = vi.hoisted(() => ({ id: '5', navigate: () => {} }));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useParams: () => ({ id: routerState.id }), useNavigate: () => routerState.navigate };
});
vi.mock('../../components/IcalExportCard', () => ({ default: () => null }));
vi.mock('../../api', () => ({
  default: {
    getArticleLabels: vi.fn(() => Promise.resolve({ labels: [] })),
    getProperty: vi.fn(), getOptions: vi.fn(), getPropertyArrivalFacts: vi.fn(), savePropertyArrivalFacts: vi.fn(),
    updateProperty: vi.fn(), createProperty: vi.fn(), deleteProperty: vi.fn(),
    getPropertyPlatforms: vi.fn(), getPlatformSettings: vi.fn(), createOption: vi.fn(), updateOption: vi.fn(),
  },
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));

import DialogProvider from '../../components/DialogProvider';
import PropertyDetail from '../PropertyDetail';
import api from '../../api';

const PROPERTY = {
  id: 5, name: 'Le Moulin', nameArticle: 'au', maxGuests: 3, maxBabies: 1, singleBeds: 1, doubleBeds: 2,
  depositPercent: 30, depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7, defaultCautionAmount: 0,
  defaultCheckIn: '15:00', defaultCheckOut: '10:00', cleaningHours: 3, pricingRules: [], documents: [], photo: null,
  pendingFacts: 'caution,cleaning,towels', cleaningIncluded: null, towelsProvided: null, poolSeasonStart: '', poolSeasonEnd: '',
};
const FACTS = { address: '', mapUrl: '', accessFr: '', accessEn: '', wifiName: 'Moulin', hasAccessCode: false, hasWifiPassword: false };

const renderAt = (url = '/properties/5?tab=sejour') => render(
  <MemoryRouter initialEntries={[url]}><DialogProvider><PropertyDetail /></DialogProvider></MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  api.getOptions.mockResolvedValue([]);
  api.getProperty.mockResolvedValue({ ...PROPERTY });
  api.getPropertyArrivalFacts.mockResolvedValue({ ...FACTS });
  api.savePropertyArrivalFacts.mockResolvedValue({});
  api.updateProperty.mockResolvedValue({});
  api.getPropertyPlatforms.mockResolvedValue({ platforms: [] });
  api.getPlatformSettings.mockResolvedValue({ platforms: [] });
});

test('rule 34: an « Arrivée » edit lights the page bar, is saved by it, and is guarded on leaving', async () => {
  renderAt();
  const wifi = await screen.findByLabelText('Réseau Wi-Fi');
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  fireEvent.change(wifi, { target: { value: 'Moulin-Invites' } });
  expect(screen.getByRole('tab', { name: /Séjour/ })).toContainElement(screen.getByLabelText('modifié'));
  // The menu asks the page first: blocked while unsaved.
  expect(window.__guestflowBeforeNavigate('/planning')).toBe(true);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: /Rester/ }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.savePropertyArrivalFacts).toHaveBeenCalledWith('5', {
    address: '', mapUrl: '', accessFr: '', accessEn: '', wifiName: 'Moulin-Invites',
  }));
  expect(api.updateProperty).not.toHaveBeenCalled();
});

test('rule 34: « Annuler » puts the « Arrivée » fields back', async () => {
  renderAt();
  fireEvent.change(await screen.findByLabelText('Réseau Wi-Fi'), { target: { value: 'Autre' } });
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(screen.getByLabelText('Réseau Wi-Fi')).toHaveValue('Moulin');
});

test('rule 27: an unanswered fact is not sent; once chosen it is', async () => {
  renderAt();
  await screen.findByLabelText('Réseau Wi-Fi');
  expect(screen.getAllByText('À préciser')).toHaveLength(2);
  fireEvent.mouseDown(screen.getByLabelText('Ménage de fin de séjour'));
  fireEvent.click(within(await screen.findByRole('listbox')).getByText('Non compris'));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateProperty).toHaveBeenCalled());
  const fd = api.updateProperty.mock.calls[0][1];
  expect(fd.get('cleaningIncluded')).toBe('0');
  expect(fd.has('towelsProvided')).toBe(false);
  expect(fd.has('defaultCautionAmount')).toBe(false);
});

test('rule 33: the pool season is chosen as a day and a month on the Séjour tab', async () => {
  renderAt();
  await screen.findByLabelText('Réseau Wi-Fi');
  fireEvent.click(screen.getByLabelText('Piscine'));
  fireEvent.mouseDown(screen.getAllByLabelText('Jour')[0]);
  fireEvent.click(within(await screen.findByRole('listbox')).getByText('15'));
  fireEvent.mouseDown(screen.getAllByLabelText('Mois')[0]);
  fireEvent.click(within(await screen.findByRole('listbox')).getByText('Juin'));
  fireEvent.mouseDown(screen.getAllByLabelText('Jour')[1]);
  fireEvent.click(within(await screen.findByRole('listbox')).getByText('31'));
  fireEvent.mouseDown(screen.getAllByLabelText('Mois')[1]);
  fireEvent.click(within(await screen.findByRole('listbox')).getByText('Août'));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateProperty).toHaveBeenCalled());
  const fd = api.updateProperty.mock.calls[0][1];
  expect(fd.get('poolSeasonStart')).toBe('06-15');
  expect(fd.get('poolSeasonEnd')).toBe('08-31');
  expect(fd.has('poolOpen')).toBe(false);
});
