/**
 * SettingsSmtpSection — "Envoi d'emails (SMTP)" card in /parametres.
 * Pure presentational: drives onChange / onChangePassword / onSendTest callbacks.
 * See specs/admin-account-management.md M3.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsSmtpSection from '../SettingsSmtpSection';

const COMPLETE = {
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  username: 'me@s.com',
  passwordSet: true,
  fromEmail: 'me@s.com',
  fromName: 'GuestFlow',
  publicUrl: 'https://guestflow.adn-dev.fr',
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

test('renders the SMTP fields with their current values', () => {
  renderSection();
  expect(screen.getByDisplayValue('smtp.gmail.com')).toBeInTheDocument();
  expect(screen.getByDisplayValue('587')).toBeInTheDocument();
  expect(screen.getByDisplayValue('https://guestflow.adn-dev.fr')).toBeInTheDocument();
});

test('typing in the host field forwards (key, value) to onChange', async () => {
  const user = userEvent.setup();
  const { onChange } = renderSection({ values: { ...COMPLETE, host: '' } });
  await user.type(screen.getByLabelText(/Hôte SMTP/), 'x');
  expect(onChange).toHaveBeenCalledWith('host', 'x');
});

test('surfaces a server-side validation error on the host field', () => {
  renderSection({ errors: { smtpHost: 'Hôte requis' } });
  expect(screen.getByText('Hôte requis')).toBeInTheDocument();
});

test('the test button is enabled when host, fromEmail and a saved password are present', () => {
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
  expect(screen.getByLabelText(/Hôte SMTP/)).toBeDisabled();
  expect(screen.getByRole('button', { name: /Envoyer un mail de test/ })).toBeDisabled();
});
