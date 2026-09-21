/**
 * SettingsSmtpSection — « Envoi » card of Paramètres → Emails & notifications.
 * Pure presentational: drives onChange / onChangePassword / onSendTest callbacks.
 * See specs/admin-account-management.md M3 and specs/settings-rationalization.md rules 11-12.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsSmtpSection from '../SettingsSmtpSection';

const COMPLETE = {
  host: 'smtp.gmail.com',
  secure: false,
  username: '',
  passwordSet: true,
  fromEmail: '',
  fromName: '',
  derived: { fromEmail: 'me@s.com', username: 'me@s.com', fromName: 'Domaine Solio' },
};

function renderSection(props = {}) {
  const onChange = vi.fn();
  const onChangePassword = vi.fn();
  const onSendTest = vi.fn();
  render(
    <SettingsSmtpSection
      values={COMPLETE}
      onChange={onChange}
      onChangePassword={onChangePassword}
      onSendTest={onSendTest}
      {...props}
    />,
  );
  return { onChange, onChangePassword, onSendTest };
}

test('renders the host, and the derived identity until it is overridden', () => {
  renderSection();
  expect(screen.getByDisplayValue('smtp.gmail.com')).toBeInTheDocument();
  expect(screen.getByLabelText("Adresse d'envoi")).toHaveValue('me@s.com');
  expect(screen.getByLabelText('Nom affiché')).toHaveValue('Domaine Solio');
  expect(screen.queryByLabelText(/URL publique/)).not.toBeInTheDocument();
});

test('an override is shown as typed, with a way back to the derived value', () => {
  renderSection({ values: { ...COMPLETE, fromEmail: 'no-reply@s.com' } });
  expect(screen.getByLabelText("Adresse d'envoi")).toHaveValue('no-reply@s.com');
  expect(screen.getByRole('button', { name: 'Revenir à la valeur déduite' })).toBeInTheDocument();
});

// specs/settings-rationalization.md rule 11 — the port is not entered: it follows the security mode.
test('rule 11: there is no port field; the port in use is stated under the security select', () => {
  renderSection();
  expect(screen.queryByLabelText('Port')).not.toBeInTheDocument();
  expect(screen.getByText('Port utilisé : 587 (déduit).')).toBeInTheDocument();
  expect(screen.getByLabelText('Sécurité')).toBeInTheDocument();
});

test('typing in the host field forwards (key, value) to onChange', async () => {
  const user = userEvent.setup();
  const { onChange } = renderSection({ values: { ...COMPLETE, host: '' } });
  await user.type(screen.getByLabelText(/Serveur SMTP/), 'x');
  expect(onChange).toHaveBeenCalledWith('host', 'x');
});

test('surfaces a server-side validation error on the host field', () => {
  renderSection({ errors: { smtpHost: 'Hôte requis' } });
  expect(screen.getByText('Hôte requis')).toBeInTheDocument();
});

// The server refuses a display name carrying a control character (it would break out of the
// `From:` header) — the message has to land under the field, not vanish into a toast.
test('surfaces the header-injection error on the sender-name field', () => {
  const message = 'Caractère interdit (retour à la ligne ou caractère de contrôle).';
  renderSection({ values: { ...COMPLETE, fromName: 'Bad\nName' }, errors: { smtpFromName: message } });
  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.queryByText(/Nom affiché aux destinataires/)).not.toBeInTheDocument();
});

test('the test button is enabled when host, a (derived) sending address and a saved password are present', () => {
  renderSection();
  expect(screen.getByRole('button', { name: /Envoyer un mail de test/ })).toBeEnabled();
});

test('the test button is disabled when no password is set or drafted', () => {
  renderSection({ values: { ...COMPLETE, passwordSet: false, passwordDraft: undefined } });
  expect(screen.getByRole('button', { name: /Envoyer un mail de test/ })).toBeDisabled();
});

test('a drafted password (no saved one) is enough to enable the test button', () => {
  renderSection({ values: { ...COMPLETE, passwordSet: false, passwordDraft: 'app-pw' } });
  expect(screen.getByRole('button', { name: /Envoyer un mail de test/ })).toBeEnabled();
});

test('the test button is disabled when host is missing', () => {
  renderSection({ values: { ...COMPLETE, host: '' } });
  expect(screen.getByRole('button', { name: /Envoyer un mail de test/ })).toBeDisabled();
});

test('clicking the test button calls onSendTest', async () => {
  const user = userEvent.setup();
  const { onSendTest } = renderSection();
  await user.click(screen.getByRole('button', { name: /Envoyer un mail de test/ }));
  expect(onSendTest).toHaveBeenCalled();
});

test('shows a spinner and disables the button while testing', () => {
  renderSection({ testing: true });
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Envoyer un mail de test/ })).toBeDisabled();
});

test('renders the test result alert', () => {
  renderSection({ testResult: { severity: 'success', message: 'Email de test envoyé.' } });
  expect(screen.getByText('Email de test envoyé.')).toBeInTheDocument();
});

test('every field is disabled when the section is disabled', () => {
  renderSection({ disabled: true });
  expect(screen.getByLabelText(/Serveur SMTP/)).toBeDisabled();
  expect(screen.getByRole('button', { name: /Envoyer un mail de test/ })).toBeDisabled();
});
