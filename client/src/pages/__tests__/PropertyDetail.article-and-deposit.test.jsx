// specs/guest-email-texts-made-simple.md rules 27 and 29 (2026-10-18) — saving the property page sends
// neither an article nobody chose (it would confirm it) nor an empty deposit (it would reset it); the
// article choices are the labels the server writes in the emails; the bed linen is a pending fact.

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useParams: () => ({ id: '5' }), useNavigate: () => () => {} };
});
vi.mock('../../components/IcalExportCard', () => ({ default: () => null }));
vi.mock('../../api', () => ({
  default: {
    getArticleLabels: vi.fn(), getProperty: vi.fn(), getOptions: vi.fn(), getPropertyArrivalFacts: vi.fn(),
    savePropertyArrivalFacts: vi.fn(), updateProperty: vi.fn(), createProperty: vi.fn(), deleteProperty: vi.fn(),
    getPropertyPlatforms: vi.fn(), getPlatformSettings: vi.fn(), createOption: vi.fn(), updateOption: vi.fn(),
  },
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));

import DialogProvider from '../../components/DialogProvider';
import PropertyDetail from '../PropertyDetail';
import api from '../../api';

const PROPERTY = {
  id: 5, name: 'Le Fournil', nameArticle: 'au', nameArticleConfirmed: 0, maxGuests: 3, maxBabies: 0, singleBeds: 0, doubleBeds: 1,
  depositPercent: 30, depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7, defaultCautionAmount: 0,
  defaultCheckIn: '16:00', defaultCheckOut: '10:00', cleaningHours: 3, pricingRules: [], documents: [], photo: null,
  pendingFacts: 'caution,cleaning,towels,linen', cleaningIncluded: null, towelsProvided: null, bedLinenProvided: null,
  poolSeasonStart: '', poolSeasonEnd: '',
};
const LABELS = [
  { value: 'au', label: 'au Fournil' }, { value: 'à la', label: 'à la Le Fournil' }, { value: "à l'", label: "à l'Le Fournil" },
  { value: 'aux', label: 'aux Le Fournil' }, { value: 'à', label: 'à Le Fournil' },
];

const renderAt = (url) => render(
  <MemoryRouter initialEntries={[url]}><DialogProvider><PropertyDetail /></DialogProvider></MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  api.getArticleLabels.mockResolvedValue({ labels: LABELS });
  api.getOptions.mockResolvedValue([]);
  api.getProperty.mockResolvedValue({ ...PROPERTY });
  api.getPropertyArrivalFacts.mockResolvedValue({ address: '', mapUrl: '', accessFr: '', accessEn: '', wifiName: '', hasAccessCode: false, hasWifiPassword: false });
  api.updateProperty.mockResolvedValue({});
  api.getPropertyPlatforms.mockResolvedValue({ platforms: [] });
  api.getPlatformSettings.mockResolvedValue({ platforms: [] });
});

test('rule 29: an unconfirmed article is not sent by an unrelated save', async () => {
  renderAt('/properties/5?tab=general');
  expect(await screen.findByText('À choisir pour les emails clients.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Max voyageurs'), { target: { value: '4' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateProperty).toHaveBeenCalled());
  expect(api.updateProperty.mock.calls[0][1].has('nameArticle')).toBe(false);
});

test('rule 29: the article choices and the preview are the server labels', async () => {
  renderAt('/properties/5?tab=general');
  await waitFor(() => expect(api.getArticleLabels).toHaveBeenCalledWith('Le Fournil'));
  fireEvent.mouseDown(await screen.findByLabelText('Article du nom (emails clients)'));
  fireEvent.click(within(await screen.findByRole('listbox')).getByText('au Fournil'));
  expect(await screen.findByText('Aperçu : « votre séjour au Fournil »')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateProperty).toHaveBeenCalled());
  expect(api.updateProperty.mock.calls[0][1].get('nameArticle')).toBe('au');
});

test('rule 27: an emptied deposit is not sent — the stored amount stays', async () => {
  api.getProperty.mockResolvedValue({ ...PROPERTY, nameArticleConfirmed: 1, pendingFacts: '', defaultCautionAmount: 400 });
  renderAt('/properties/5?tab=paiement');
  const caution = await screen.findByLabelText('Caution par défaut (€)');
  fireEvent.change(caution, { target: { value: '' } });
  expect(screen.getByText('Vide : rien n’est changé. 0 : pas de caution.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateProperty).toHaveBeenCalled());
  expect(api.updateProperty.mock.calls[0][1].has('defaultCautionAmount')).toBe(false);
});

test('rule 27: the bed linen left unanswered is not sent; chosen, it is', async () => {
  renderAt('/properties/5?tab=sejour');
  fireEvent.mouseDown(await screen.findByLabelText('Linge de lit'));
  fireEvent.click(within(await screen.findByRole('listbox')).getByText('À apporter'));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateProperty).toHaveBeenCalled());
  const fd = api.updateProperty.mock.calls[0][1];
  expect(fd.get('bedLinenProvided')).toBe('0');
  expect(fd.has('towelsProvided')).toBe(false);
});
