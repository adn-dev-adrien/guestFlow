/**
 * EmailTemplatesPage — CRUD list + edit dialog.
 * See specs/email-automation.md §6.1.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(),
    createEmailTemplate: vi.fn(),
    updateEmailTemplate: vi.fn(),
    deleteEmailTemplate: vi.fn(),
  },
}));

vi.mock('../../components/DialogProvider', () => ({
  __esModule: true,
  useAppDialogs: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    alert: vi.fn().mockResolvedValue(),
  }),
}));

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

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  api.getEmailTemplates.mockResolvedValue([REGISTRY_ROW, CUSTOM_ROW]);
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
  // The badge is rendered on the J-7 row only.
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
  // Wait for the dialog heading specifically (button + heading both say "Nouveau modèle").
  expect(await screen.findByRole('heading', { name: 'Nouveau modèle' })).toBeInTheDocument();
  // The submit "Enregistrer" is disabled because name/subject/body are empty.
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('the variable + condition chips for the picker are rendered in the dialog', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Rappel arrivée — J-7');
  await user.click(screen.getByRole('button', { name: 'Nouveau modèle' }));
  await screen.findByRole('heading', { name: 'Nouveau modèle' });
  // Variables picker chips
  expect(screen.getByText('Prénom client')).toBeInTheDocument();
  expect(screen.getByText('Logement')).toBeInTheDocument();
  expect(screen.getByText('Liste options')).toBeInTheDocument();
  // Condition chips
  expect(screen.getByText('Si linge de lit')).toBeInTheDocument();
  expect(screen.getByText('Si caution non encaissée')).toBeInTheDocument();
  expect(screen.getByText('Fin si')).toBeInTheDocument();
});
