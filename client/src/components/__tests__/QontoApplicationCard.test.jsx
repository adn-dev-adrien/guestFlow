/**
 * « Application Qonto » card (specs/qonto-settings-in-app.md §6).
 * What matters here is what the card refuses to show — a secret — and that it hands the operator
 * the repair sentence the server computed rather than inventing one.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import QontoApplicationCard from '../QontoApplicationCard';

const CREDENTIALS = {
  environment: 'sandbox',
  clientId: 'cid_visible_123',
  clientIdSource: 'db',
  oauthBase: 'https://oauth-sandbox.staging.qonto.co',
  apiBase: 'https://thirdparty-sandbox.staging.qonto.co',
  redirectUri: 'https://guestflow.example/api/payments/qonto/callback',
  publicSiteOrigin: 'https://www.domainesolio.com',
  secrets: {
    clientSecret: { configured: true, source: 'db' },
    stagingToken: { configured: true, source: 'db' },
    webhookSecret: { configured: false, source: 'none' },
  },
};

const REJECTED = {
  state: 'credentials_rejected',
  ok: false,
  title: 'Identifiants refusés par Qonto',
  explanation: "Qonto ne reconnaît pas le couple Client ID / Client secret.",
  action: 'Recopie le Client ID et le Client secret depuis developers.qonto.com, puis relance le test.',
  code: 'invalid_client',
  detail: 'Client authentication failed',
};

const renderCard = (props = {}) => render(
  <QontoApplicationCard
    credentials={CREDENTIALS}
    health={{ state: 'unverified', title: 'À vérifier', explanation: 'Aucun appel réel.', action: 'Clique « Tester la connexion ».' }}
    onSave={vi.fn()}
    onTest={vi.fn()}
    {...props}
  />,
);

// Rule 4 — the identifier the operator compares with the portal must be readable.
test('shows the client id in clear so it can be compared with the Qonto portal', () => {
  renderCard();
  expect(screen.getByDisplayValue('cid_visible_123')).toBeInTheDocument();
});

// Rule 3 — a configured secret is shown as configured, never as a value: there is no input holding
// it at all, only a mask and a « Modifier » button.
test('a configured secret is shown masked, with no field carrying its value', () => {
  const { container } = renderCard();
  expect(screen.getByText('Client secret')).toBeInTheDocument();
  expect(screen.getAllByText(/^[•]+$/).length).toBeGreaterThan(0);
  expect(screen.queryByLabelText(/^Client secret$/)).not.toBeInTheDocument();
  const inputs = [...container.querySelectorAll('input')].map((i) => i.value);
  expect(inputs.some((v) => /secret/i.test(v))).toBe(false);
});

// Rule 3 — an unconfigured secret is a normal empty field to fill.
test('an unconfigured secret is offered as an empty field', () => {
  renderCard();
  expect(screen.getByLabelText(/Secret du webhook/i)).toHaveValue('');
});

// Rule 10 — the page hands over the server's diagnosis, including the repair action.
test('renders the failure, its Qonto code and the action that repairs it', () => {
  renderCard({ testResult: REJECTED });
  expect(screen.getByText('Identifiants refusés par Qonto')).toBeInTheDocument();
  expect(screen.getByText(REJECTED.action)).toBeInTheDocument();
  expect(screen.getByText(/invalid_client — Client authentication failed/)).toBeInTheDocument();
});

test('a fresh test result replaces the stored state', () => {
  const { rerender } = renderCard();
  expect(screen.getByText('À vérifier')).toBeInTheDocument();
  rerender(
    <QontoApplicationCard
      credentials={CREDENTIALS}
      health={{ state: 'unverified', title: 'À vérifier', explanation: '', action: '' }}
      testResult={{ state: 'ok', ok: true, title: 'Connexion opérationnelle', explanation: 'Tout marche.', action: '' }}
      onSave={vi.fn()}
      onTest={vi.fn()}
    />,
  );
  expect(screen.getByText('Connexion opérationnelle')).toBeInTheDocument();
});

// Rule 1 — only what the operator touched is sent, so an untouched secret is never overwritten.
test('saving sends only the edited fields', async () => {
  const onSave = vi.fn();
  renderCard({ onSave });
  await userEvent.clear(screen.getByLabelText(/Client ID/i));
  await userEvent.type(screen.getByLabelText(/Client ID/i), 'cid_new');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(onSave).toHaveBeenCalledWith({ clientId: 'cid_new' });
});

test('the save button stays disabled until something is edited', async () => {
  renderCard();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

// Rule 9 — the operator can run a real check from the page.
test('the test button asks the server for a real connection test', async () => {
  const onTest = vi.fn();
  renderCard({ onTest });
  await userEvent.click(screen.getByRole('button', { name: 'Tester la connexion' }));
  expect(onTest).toHaveBeenCalled();
});

// Rule 6 — the URI to declare at Qonto is displayed, ready to copy.
test('displays the redirect URI to declare in the Qonto portal', () => {
  renderCard();
  expect(screen.getByText(CREDENTIALS.redirectUri)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Copier l’URL de redirection/ })).toBeEnabled();
});

// Rule 5 — the operator sees which servers will actually be called.
test('displays the hosts the current environment resolves to', () => {
  renderCard();
  expect(screen.getByText(/oauth-sandbox\.staging\.qonto\.co/)).toBeInTheDocument();
});

// Rule 5 — the staging token only exists in the sandbox.
test('the sandbox token field disappears in production', async () => {
  renderCard({ credentials: { ...CREDENTIALS, environment: 'production' } });
  expect(screen.queryByLabelText(/Jeton bac à sable/i)).not.toBeInTheDocument();
});
