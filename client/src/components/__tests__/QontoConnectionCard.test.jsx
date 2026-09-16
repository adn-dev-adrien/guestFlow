import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';

// specs/settings-one-save-and-automatic-webhook.md §3 rules 6, 12, 13 — « Application Qonto » and
// « Connexion bancaire (Qonto) » became one card: the redirect URI first, the credentials, the date
// of the last verification, then two actions that wait for the page to be saved.

import QontoConnectionCard from '../QontoConnectionCard';

const CREDENTIALS = {
  environment: 'production',
  clientId: 'guestflow-prod-8a21',
  publicSiteOrigin: 'https://domainesolio.com',
  redirectUri: 'https://guestflow.adn-dev.fr/api/payments/qonto/callback',
  oauthBase: 'https://oauth.qonto.com',
  apiBase: 'https://thirdparty.qonto.com',
  secrets: { clientSecret: { configured: true }, stagingToken: { configured: false } },
};

const HEALTH_OK = { state: 'ok', title: 'Connexion opérationnelle', explanation: 'Tout fonctionne.' };

function renderCard(props = {}) {
  const onChange = vi.fn();
  const onConnect = vi.fn();
  const onTest = vi.fn();
  render(
    <QontoConnectionCard
      credentials={CREDENTIALS}
      draft={{}}
      onChange={onChange}
      badge={{ status: 'success', label: 'Connecté' }}
      health={HEALTH_OK}
      testResult={null}
      lastCheckLabel="16/09/2026 09:14"
      dirty={false}
      canConnect
      testing={false}
      onConnect={onConnect}
      onTest={onTest}
      {...props}
    />,
  );
  return { onChange, onConnect, onTest };
}

// Rule 12 — one card, and the title is a section header like every other card on the page.
test('rule 12: a single « Connexion bancaire » card carries the credentials and the badge', () => {
  renderCard();
  expect(screen.getByText('Connexion bancaire')).toBeInTheDocument();
  expect(screen.getByText('Connecté')).toBeInTheDocument();
  expect(screen.getByLabelText('Client ID')).toHaveValue('guestflow-prod-8a21');
  expect(screen.getByText('Dernière vérification')).toBeInTheDocument();
  expect(screen.getByText('16/09/2026 09:14')).toBeInTheDocument();
});

// Rule 12 — what the diagnosis already names is not repeated as summary lines.
test('rule 12: the mode, the credentials line, the provider line and the hosts are gone', () => {
  renderCard();
  expect(screen.queryByText('Serveurs appelés')).not.toBeInTheDocument();
  expect(screen.queryByText(/thirdparty\.qonto\.com/)).not.toBeInTheDocument();
  expect(screen.queryByText('Mode')).not.toBeInTheDocument();
  expect(screen.queryByText('Identifiants')).not.toBeInTheDocument();
  expect(screen.queryByText('Provider de liens')).not.toBeInTheDocument();
});

// Rule 6 — a secret typed into a form is a secret on a screen. It has no field here any more.
test('rule 6: there is no webhook-secret field and no webhook button', () => {
  renderCard();
  expect(screen.queryByText('Secret du webhook')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enregistrer le webhook' })).not.toBeInTheDocument();
});

// Rule 1 — the card does not write: the page's action bar does.
test('rule 1: the card carries no Enregistrer button', () => {
  renderCard();
  expect(screen.queryByRole('button', { name: /Enregistrer/ })).not.toBeInTheDocument();
});

// Rule 12 — the redirect URI is the first thing to declare at Qonto, so it opens the card.
test('rule 12: the redirect URI is rendered before the credential fields', () => {
  const { container } = render(
    <QontoConnectionCard
      credentials={CREDENTIALS} draft={{}} onChange={() => {}} badge={null} health={HEALTH_OK}
      lastCheckLabel="" dirty={false} canConnect testing={false} onConnect={() => {}} onTest={() => {}}
    />,
  );
  const text = container.textContent;
  expect(text.indexOf('URL de redirection à déclarer chez Qonto')).toBeLessThan(text.indexOf('Client ID'));
  expect(text.indexOf('Client ID')).toBeLessThan(text.indexOf('Dernière vérification'));
});

// Rule 13 — two actions, in that order, with those labels.
test('rule 13: the two actions are « Connexion » then « Test »', () => {
  const { onConnect, onTest } = renderCard();
  // The card's own actions close it; « Modifier » belongs to the masked secret field above.
  const buttons = screen.getAllByRole('button').map((b) => b.textContent.trim()).filter((t) => t);
  expect(buttons.slice(-2)).toEqual(['Connexion', 'Test']);

  fireEvent.click(screen.getByRole('button', { name: 'Connexion' }));
  expect(onConnect).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Test' }));
  expect(onTest).toHaveBeenCalled();
});

// Rule 13 — acting on credentials the server has not seen yet would test the wrong thing.
test('rule 13: unsaved changes make both actions unavailable, and say why on hover', async () => {
  renderCard({ dirty: true });

  expect(screen.getByRole('button', { name: 'Connexion' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Test' })).toBeDisabled();

  fireEvent.mouseOver(screen.getByRole('button', { name: 'Test' }).parentElement);
  expect(await screen.findAllByText('Enregistre d’abord tes modifications.')).not.toHaveLength(0);
});

// Rule 13 — without credentials there is nothing to authorise; the reason is its own.
test('rule 13: « Connexion » stays unavailable while the credentials are missing', () => {
  renderCard({ canConnect: false });
  expect(screen.getByRole('button', { name: 'Connexion' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Test' })).toBeEnabled();
});

// The card is controlled: every edit goes up to the page, which owns the draft the bar saves.
test('rule 1: editing a field reports the change to the page instead of keeping it', () => {
  const { onChange } = renderCard();
  fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'guestflow-prod-8a22' } });
  expect(onChange).toHaveBeenCalledWith('clientId', 'guestflow-prod-8a22');
});

// The diagnosis the server computed is what the operator reads (specs/qonto-settings-in-app.md §3).
test('the test result takes precedence over the stored health', () => {
  renderCard({
    testResult: {
      state: 'credentials_rejected',
      title: 'Identifiants refusés par Qonto',
      explanation: 'Le secret est refusé.',
      action: 'Recopie le Client secret, puis relance le test.',
      code: 'invalid_client',
    },
  });
  const alert = screen.getByRole('alert');
  expect(within(alert).getByText('Identifiants refusés par Qonto')).toBeInTheDocument();
  expect(within(alert).getByText('Recopie le Client secret, puis relance le test.')).toBeInTheDocument();
  expect(screen.queryByText('Connexion opérationnelle')).not.toBeInTheDocument();
});

// The sandbox token is only asked for in the sandbox.
test('the staging token appears only when the environment is the sandbox', () => {
  renderCard();
  expect(screen.queryByText('Jeton bac à sable')).not.toBeInTheDocument();

  renderCard({ draft: { environment: 'sandbox' } });
  expect(screen.getAllByText('Jeton bac à sable').length).toBeGreaterThan(0);
});
