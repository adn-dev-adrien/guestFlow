// specs/control-plane-plans-and-access.md rule 33 — the renewal emails: the mode switch, the editor
// with its placeholders and the server's preview, and the refusal of an unknown placeholder.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import EmailTemplatesPage from '../pages/EmailTemplatesPage';
import api from '../api';
import { renderAt, setWidth } from './consoleFixtures';

vi.mock('../api', () => ({ default: { templates: vi.fn(), saveTemplate: vi.fn(), previewTemplate: vi.fn() } }));

const tpl = (key, name, sendMode) => ({
  key, name, day: 'le jour de l’échéance', subject: `Objet ${key}`, body: 'Bonjour {{contactName}},',
  sendMode, modeLabel: sendMode === null ? 'Le clic vaut validation' : (sendMode === 'auto' ? 'Automatique' : 'Manuel'),
});

beforeEach(() => {
  vi.clearAllMocks();
  setWidth(1280);
  api.templates.mockResolvedValue({ templates: [tpl('reminder_due', 'Relance jour J', 'manual'), tpl('reminder_manual', 'Relancer maintenant', null)], placeholders: ['contactName', 'payUrl'] });
  api.previewTemplate.mockImplementation(async (key, { subject, body }) => ({
    error: /\{\{prenom\}\}/.test(body) ? 'Variable inconnue : {{prenom}}.' : null,
    subject, body: body.replace('{{contactName}}', 'Claire'),
  }));
});

it('rule 33 — the switch changes the mode through the server; the click-only template has none', async () => {
  api.saveTemplate.mockResolvedValue({ template: tpl('reminder_due', 'Relance jour J', 'auto'), notice: 'Modèle « Relance jour J » enregistré : il partira seul.' });
  renderAt(<EmailTemplatesPage />);
  expect(await screen.findByText('Le clic vaut validation')).toBeInTheDocument();
  expect(screen.getAllByRole('switch')).toHaveLength(1);
  fireEvent.click(screen.getByRole('switch', { name: 'Envoi automatique : Relance jour J' }));
  await waitFor(() => expect(api.saveTemplate).toHaveBeenCalledWith('reminder_due', { sendMode: 'auto' }));
  expect(await screen.findByText('Modèle « Relance jour J » enregistré : il partira seul.')).toBeInTheDocument();
});

it('rule 33 — the editor previews on the server, inserts a placeholder and shows the refusal', async () => {
  api.saveTemplate.mockResolvedValue({ template: tpl('reminder_due', 'Relance jour J', 'manual'), notice: 'Modèle « Relance jour J » enregistré.' });
  renderAt(<EmailTemplatesPage />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Modifier' }))[0]);
  expect(await screen.findByText('Bonjour Claire,')).toBeInTheDocument();
  const body = screen.getByLabelText('Texte');
  fireEvent.change(body, { target: { value: 'Bonjour {{prenom}}' } });
  expect(await screen.findByText('Variable inconnue : {{prenom}}.')).toBeInTheDocument();
  fireEvent.change(body, { target: { value: 'Payer : ' } });
  body.setSelectionRange(8, 8);
  fireEvent.click(screen.getByText('{{payUrl}}'));
  expect(body).toHaveValue('Payer : {{payUrl}}');
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.saveTemplate).toHaveBeenCalledWith('reminder_due', { subject: 'Objet reminder_due', body: 'Payer : {{payUrl}}' }));
});
