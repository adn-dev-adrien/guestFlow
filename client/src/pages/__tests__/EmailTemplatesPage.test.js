/**
 * EmailTemplatesPage — the Emails page: « Emails à envoyer » + « Modèles d'emails » cards.
 * See specs/email-automation.md §6.1 + §6.10.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(),
    createEmailTemplate: vi.fn(),
    updateEmailTemplate: vi.fn(),
    deleteEmailTemplate: vi.fn(),
    getPendingEmails: vi.fn(),
    acknowledgePendingEmail: vi.fn(),
    previewEmail: vi.fn(),
    sendEmail: vi.fn(),
  },
}));

vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    alert: vi.fn().mockResolvedValue(),
  }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigate };
});

import api from '../../api';
import EmailTemplatesPage from '../EmailTemplatesPage';

const REGISTRY_ROW = {
  id: 1, stableKey: 'arrival_reminder_7d',
  name: 'Rappel arrivée — J-7', subject: 'S', body: 'B',
  dayOffset: -7, sendMode: 'manual', enabled: 1,
};

const CUSTOM_ROW = {
  id: 2, stableKey: null,
  name: 'Bienvenue', subject: 'S2', body: 'B2',
  dayOffset: 0, sendMode: 'auto', enabled: 1,
};

const PENDING_ROW = {
  templateId: 1, reservationId: 100, templateName: 'Rappel arrivée — J-7',
  clientFullName: 'Jane S.', clientEmail: 'jane@s.com', propertyName: 'Villa A', startDate: '2026-07-10',
};

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  navigate.mockReset();
  api.getEmailTemplates.mockResolvedValue([REGISTRY_ROW, CUSTOM_ROW]);
  api.getPendingEmails.mockResolvedValue([]); // queue empty by default
  api.previewEmail.mockResolvedValue({ to: 'jane@s.com', subject: 'Sujet', body: 'Corps', missingVariables: [] });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <EmailTemplatesPage />
    </MemoryRouter>
  );
}

test('lists templates with the "Modèle livré" badge ONLY on registry-seeded rows', async () => {
  renderPage();
  expect(await screen.findByText('Rappel arrivée — J-7')).toBeInTheDocument();
  expect(screen.getByText('Bienvenue')).toBeInTheDocument();
  const badges = screen.getAllByText('Modèle livré');
  expect(badges).toHaveLength(1);
});

test('renders the J-7 / Manuel / Auto cells correctly', async () => {
  renderPage();
  expect(await screen.findByText('J-7')).toBeInTheDocument();
  expect(screen.getByText('Manuel')).toBeInTheDocument();
  expect(screen.getByText('Auto')).toBeInTheDocument();
});

test('opening the create dialog yields an empty form + disabled submit', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Rappel arrivée — J-7');
  await user.click(screen.getByRole('button', { name: 'Nouveau modèle' }));
  expect(await screen.findByRole('heading', { name: 'Nouveau modèle' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('the variable + condition chips for the picker are rendered in the dialog', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Rappel arrivée — J-7');
  await user.click(screen.getByRole('button', { name: 'Nouveau modèle' }));
  await screen.findByRole('heading', { name: 'Nouveau modèle' });
  expect(screen.getByText('Prénom client')).toBeInTheDocument();
  expect(screen.getByText('Logement')).toBeInTheDocument();
  expect(screen.getByText('Liste options')).toBeInTheDocument();
  expect(screen.getByText('Si linge de lit')).toBeInTheDocument();
  expect(screen.getByText('Si caution non encaissée')).toBeInTheDocument();
  expect(screen.getByText('Fin si')).toBeInTheDocument();
});

test('the "Emails à envoyer" card is hidden when the queue is empty', async () => {
  renderPage();
  await screen.findByText('Rappel arrivée — J-7');
  expect(screen.queryByText('Emails à envoyer')).not.toBeInTheDocument();
});

test('the "Emails à envoyer" card shows the queue when non-empty', async () => {
  api.getPendingEmails.mockResolvedValue([PENDING_ROW]);
  renderPage();
  expect(await screen.findByText('Emails à envoyer')).toBeInTheDocument();
  expect(screen.getByText('Jane S.')).toBeInTheDocument();
  expect(screen.getByText('Villa A')).toBeInTheDocument();
});

test('clicking a template row opens its edit dialog', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByText('Bienvenue'));
  expect(await screen.findByRole('heading', { name: 'Modifier le modèle' })).toBeInTheDocument();
});

test('clicking the delete icon does NOT open the edit dialog', async () => {
  const user = userEvent.setup();
  renderPage();
  const row = (await screen.findByText('Bienvenue')).closest('tr');
  await user.click(within(row).getByRole('button')); // the only button in the row is delete
  await waitFor(() => expect(api.deleteEmailTemplate).toHaveBeenCalledWith(2));
  expect(screen.queryByRole('heading', { name: 'Modifier le modèle' })).not.toBeInTheDocument();
});

test('toggling the enabled switch does NOT open the edit dialog', async () => {
  const user = userEvent.setup();
  renderPage();
  const row = (await screen.findByText('Bienvenue')).closest('tr');
  await user.click(row.querySelector('input[type="checkbox"]'));
  await waitFor(() => expect(api.updateEmailTemplate).toHaveBeenCalled());
  expect(screen.queryByRole('heading', { name: 'Modifier le modèle' })).not.toBeInTheDocument();
});

test('changing a template regenerates the pending queue (re-fetches it)', async () => {
  const user = userEvent.setup();
  renderPage();
  const row = (await screen.findByText('Bienvenue')).closest('tr');
  await waitFor(() => expect(api.getPendingEmails).toHaveBeenCalledTimes(1)); // initial load
  await user.click(row.querySelector('input[type="checkbox"]')); // toggle enabled
  await waitFor(() => expect(api.updateEmailTemplate).toHaveBeenCalled());
  // The queue is refreshed so it reflects the new template set.
  await waitFor(() => expect(api.getPendingEmails).toHaveBeenCalledTimes(2));
});

test('clicking a queue row opens the manual send dialog', async () => {
  const user = userEvent.setup();
  api.getPendingEmails.mockResolvedValue([PENDING_ROW]);
  renderPage();
  await user.click(await screen.findByText('Villa A')); // a non-name cell in the queue row
  // The send dialog's banner surfaces the recipient + a Send button.
  expect(await screen.findByText('Destinataire')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Envoyer$/ })).toBeInTheDocument();
});

test('clicking the queue client name navigates to the reservation', async () => {
  const user = userEvent.setup();
  api.getPendingEmails.mockResolvedValue([PENDING_ROW]);
  renderPage();
  await user.click(await screen.findByText('Jane S.'));
  expect(navigate).toHaveBeenCalledWith('/reservations/100');
});
