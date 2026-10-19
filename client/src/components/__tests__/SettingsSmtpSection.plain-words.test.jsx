// specs/plugins-phase-p-productisation.md rule 41 — the sending server is described in plain words; the
// protocol names (STARTTLS, TLS) stay folded under « Réglages avancés », closed at first — with the
// server field and the login since specs/settings-rationalization.md rule 28.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsSmtpSection from '../SettingsSmtpSection';

const VALUES = {
  host: 'smtp.example.org', secure: false, username: '', passwordSet: true, fromEmail: '', fromName: '',
  derived: { fromEmail: 'me@example.org', username: 'me@example.org', fromName: 'Gîte' },
};

test('rule 41: no « SMTP » in the labels, the security mode folded under « Réglages avancés »', () => {
  render(<SettingsSmtpSection values={VALUES} onChange={vi.fn()} onChangePassword={vi.fn()} onSendTest={vi.fn()} />);
  expect(screen.getByText('Serveur d’envoi : smtp.example.org.')).toBeInTheDocument();
  expect(screen.queryByLabelText(/SMTP/)).not.toBeInTheDocument();
  const advanced = screen.getByRole('button', { name: 'Réglages avancés' });
  expect(advanced).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(advanced);
  expect(advanced).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByLabelText('Sécurité de la connexion')).toBeVisible();
  expect(screen.getByLabelText('Serveur d’envoi')).toBeVisible();
  expect(screen.getByLabelText('Identifiant du serveur')).toBeVisible();
});
