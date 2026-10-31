// specs/server-test-isolation.md rule 11 — a « nothing shown » check first waits for the answer that could show it.
/**
 * EmailTemplatesPage — the Emails page: « Emails à envoyer » + « Modèles d'emails » cards.
 * See specs/email-automation.md §6.1 + §6.10; the timeline of the templates is
 * specs/guest-email-texts-made-simple.md rule 44.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

// Every plugin active (specs/plugins-phase-1-sdk.md rule 13 — the token picker lists plugin tokens).
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(),
    getEmailTemplatesTimeline: vi.fn(), getEmailTemplate: vi.fn(),
    describeTemplateWhen: vi.fn(),
    getEmailTemplateVariables: vi.fn(),
    createEmailTemplate: vi.fn(),
    updateEmailTemplate: vi.fn(),
    deleteEmailTemplate: vi.fn(),
    getPendingEmails: vi.fn(),
    acknowledgePendingEmail: vi.fn(),
    previewEmail: vi.fn(),
    sendEmail: vi.fn(),
  },
}));

vi.mock('../../components/DialogProvider', () => {
  // Stable identities, like the real provider (its context value is memoized) — a fresh object per
  // render would re-trigger useCallback/useEffect chains that depend on the toast fns.
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  const stableDialogs = {
    confirm: vi.fn().mockResolvedValue(true),
    alert: vi.fn().mockResolvedValue(),
  };
  return {
    __esModule: true,
    useAppDialogs: () => stableDialogs,
    useToast: () => stableToast,
  };
});

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigate };
});

import api from '../../api';
import { useAppDialogs } from '../../components/DialogProvider';
import EmailTemplatesPage from '../EmailTemplatesPage';

const dialogs = useAppDialogs();

// The server's shapes (specs/guest-email-texts-made-simple.md rules 43–44): one name, the « Quand ».
const REGISTRY_ROW = {
  id: 1, stableKey: 'arrival_reminder_7d', textsSection: 'j7', shipped: true,
  name: 'Rappel arrivée — J-7', displayName: 'Préparation du séjour', subject: 'S', body: 'B',
  dayOffset: -7, sendMode: 'manual', enabled: 1,
  when: { editable: false, label: '7 jours avant l’arrivée', sentence: 'Envoyé 7 jours avant l’arrivée', days: 7, direction: 'before', anchorLabel: 'l’arrivée' },
};

const CUSTOM_ROW = {
  id: 2, stableKey: null, textsSection: null, shipped: false,
  name: 'Bienvenue', displayName: 'Bienvenue', subject: 'S2', body: 'B2',
  dayOffset: 0, sendMode: 'auto', enabled: 1,
  when: { editable: true, label: 'Le jour de l’arrivée', sentence: 'Envoyé le jour de l’arrivée', days: 0, direction: 'same', anchorLabel: 'l’arrivée' },
};

const TIMELINE = { groups: [
  { id: 'before', label: 'Avant l’arrivée', templates: [REGISTRY_ROW] },
  { id: 'during', label: 'Pendant le séjour', templates: [CUSTOM_ROW] },
] };

const PENDING_ROW = {
  templateId: 1, reservationId: 100, templateName: 'Rappel arrivée — J-7',
  clientFullName: 'Jane S.', clientEmail: 'jane@s.com', propertyName: 'Villa A', startDate: '2026-07-10',
};

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  dialogs.confirm.mockClear();
  dialogs.confirm.mockResolvedValue(true);
  navigate.mockReset();
  api.getEmailTemplatesTimeline.mockResolvedValue(TIMELINE);
  api.getEmailTemplate.mockImplementation(async (id) => [REGISTRY_ROW, CUSTOM_ROW].find((t) => t.id === id));
  api.getEmailTemplates.mockResolvedValue([REGISTRY_ROW, CUSTOM_ROW]);
  api.describeTemplateWhen.mockResolvedValue({ offsetDays: -2, sentence: 'Envoyé 2 jours avant l’arrivée', example: 'Prochain séjour (Gite, vendredi 23 octobre au lundi 26 octobre) : envoyé le mercredi 21 octobre.' });
  api.getEmailTemplateVariables.mockResolvedValue({ variables: [{ name: 'clientFirstName', label: 'Prénom du voyageur' }, { name: 'propertyName', label: 'Logement' }], conditions: [{ name: 'hasBedLinenOption', label: 'Si linge de lit' }] });
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

test('specs/guest-email-texts-made-simple.md rule 44: the emails read in stay order, by name, with « personnalisé » only on the operator’s own', async () => {
  renderPage();
  expect(await screen.findByText('Préparation du séjour')).toBeInTheDocument();
  expect(screen.getByText('Bienvenue')).toBeInTheDocument();
  expect(screen.getAllByText('personnalisé')).toHaveLength(1);
  expect(screen.queryByText('Modèle livré')).not.toBeInTheDocument();
  const moments = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
  expect(moments).toEqual(['Avant l’arrivée', 'Pendant le séjour']);
});

test('specs/guest-email-texts-made-simple.md rule 44: the « Quand » under each name; the mode only when it is « Auto »', async () => {
  renderPage();
  expect(await screen.findByText('7 jours avant l’arrivée')).toBeInTheDocument();
  expect(screen.queryByText('Manuel')).not.toBeInTheDocument();
  expect(screen.getAllByText('Auto')).toHaveLength(1);
});

test('opening the create dialog yields an empty form + disabled submit', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Préparation du séjour');
  await user.click(screen.getByRole('button', { name: 'Nouveau modèle' }));
  expect(await screen.findByRole('heading', { name: 'Nouveau modèle' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

// specs/guest-email-texts-made-simple.md rules 10, 37 — the variables are the server's, labelled,
// behind « + Variable ».
test('the variables and conditions of the server are offered by « + Variable » in the dialog', async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText('Préparation du séjour');
  await user.click(screen.getByRole('button', { name: 'Nouveau modèle' }));
  await screen.findByRole('heading', { name: 'Nouveau modèle' });
  expect(api.getEmailTemplateVariables).toHaveBeenCalledWith(null);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Variable' }).length).toBe(2));
  await user.click(screen.getAllByRole('button', { name: 'Variable' })[1]);
  expect(await screen.findByRole('option', { name: 'Prénom du voyageur' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Logement' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Seulement si : linge de lit' })).toBeInTheDocument();
});

test('the "Emails à envoyer" card is hidden when the queue is empty', async () => {
  renderPage();
  await screen.findByText('Préparation du séjour');
  expect(screen.queryByText('Emails à envoyer')).not.toBeInTheDocument();
});

test('the "Emails à envoyer" card shows the queue when non-empty', async () => {
  api.getPendingEmails.mockResolvedValue([PENDING_ROW]);
  renderPage();
  expect(await screen.findByText('Emails à envoyer')).toBeInTheDocument();
  expect(screen.getByText('Jane S.')).toBeInTheDocument();
  expect(screen.getByText('Villa A')).toBeInTheDocument();
});

test('specs/guest-email-texts-made-simple.md rule 44: the operator’s own row opens its editor; a shipped row opens its texts', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier les textes : Préparation du séjour' }));
  expect(navigate).toHaveBeenCalledWith('/settings/emails/textes#j7');
  await user.click(screen.getByRole('button', { name: 'Modifier : Bienvenue' }));
  expect(await screen.findByRole('heading', { name: 'Bienvenue' })).toBeInTheDocument();
});

test('specs/guest-email-texts-made-simple.md rule 44: « Supprimer » sits in « ⋯ »; a shipped email cannot be deleted, only switched off', async () => {
  let answer;
  api.deleteEmailTemplate.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Plus d’actions : Préparation du séjour' }));
  expect(screen.getByRole('menuitem', { name: /Supprimer/ })).toHaveAttribute('aria-disabled', 'true');
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Plus d’actions : Bienvenue' }));
  await user.click(screen.getByRole('menuitem', { name: 'Supprimer' }));
  await waitFor(() => expect(api.deleteEmailTemplate).toHaveBeenCalledWith(2));
  await act(async () => { answer(); });
  expect(screen.queryByRole('heading', { name: 'Bienvenue' })).not.toBeInTheDocument();
});

test('specs/guest-email-texts-made-simple.md rule 44: « Envoi automatique… » from « ⋯ », after its confirmation, never as the first item', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Plus d’actions : Préparation du séjour' }));
  const items = screen.getAllByRole('menuitem');
  expect(items[0]).toHaveTextContent('Modifier le modèle');
  await user.click(screen.getByRole('menuitem', { name: 'Envoi automatique…' }));
  expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'Cet email partira sans validation, à sa date.' }));
  await waitFor(() => expect(api.updateEmailTemplate).toHaveBeenCalledWith(1, { sendMode: 'auto' }));
});

test('specs/guest-email-texts-made-simple.md rule 44: a refused confirmation keeps the email manual', async () => {
  const user = userEvent.setup();
  dialogs.confirm.mockResolvedValueOnce(false);
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Plus d’actions : Préparation du séjour' }));
  await user.click(screen.getByRole('menuitem', { name: 'Envoi automatique…' }));
  await waitFor(() => expect(dialogs.confirm).toHaveBeenCalled());
  expect(api.updateEmailTemplate).not.toHaveBeenCalled();
});

test('toggling the enabled switch does NOT open the edit dialog', async () => {
  let answer;
  api.updateEmailTemplate.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('switch', { name: 'Envoyer Bienvenue' }));
  await waitFor(() => expect(api.updateEmailTemplate).toHaveBeenCalled());
  await act(async () => { answer(); });
  expect(screen.queryByRole('heading', { name: 'Bienvenue' })).not.toBeInTheDocument();
});

test('changing a template regenerates the pending queue (re-fetches it)', async () => {
  const user = userEvent.setup();
  renderPage();
  const toggle = await screen.findByRole('switch', { name: 'Envoyer Bienvenue' });
  await waitFor(() => expect(api.getPendingEmails).toHaveBeenCalledTimes(1)); // initial load
  await user.click(toggle); // toggle enabled
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

// ---- automatic sending per template (specs/settings-rationalization.md rule 17b) ----
// A template's own mode is the only switch: no « Auto désactivé » state, no banner sending the
// operator to a global setting.

test('no global « automatic sending is off » banner exists any more', async () => {
  renderPage();
  await screen.findByText('Bienvenue');
  expect(screen.queryByText(/L'envoi automatique est désactivé/)).not.toBeInTheDocument();
  expect(screen.queryByText('Auto désactivé')).not.toBeInTheDocument();
});

test('the edit dialog says an « Automatique » template leaves without validation', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByRole('button', { name: 'Modifier : Bienvenue' }));
  expect(await screen.findByText(/Part sans validation/)).toBeInTheDocument();
});
