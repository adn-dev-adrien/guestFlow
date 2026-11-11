// specs/settings-rationalization.md rule 28 (UI/UX review 2026-10-18, decision 14) — the operator
// types the address and the password: the server found from the address is said under the password,
// with the provider's own hint; not found, the card says so and opens « Réglages avancés » on the
// server field; a saved host always wins; the test button says what it waits for.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsSmtpSection from '../SettingsSmtpSection';

const base = {
  host: '', secure: false, username: '', passwordSet: false, fromEmail: '', fromName: '',
  derived: { fromEmail: 'contact@domainesolio.com', username: 'contact@domainesolio.com', fromName: 'Domaine Solio' },
};
const GMAIL = { id: 'google', name: 'Gmail', host: 'smtp.gmail.com', secure: true, port: 465, hint: 'Un mot de passe d’application Google (16 lettres).' };
const draw = (values, detection) => render(
  <SettingsSmtpSection values={values} detection={detection} onChange={vi.fn()} onChangePassword={vi.fn()} onSendTest={vi.fn()} />,
);

test('rule 28: found — the provider and its server are said, with its password hint, the advanced settings folded', () => {
  draw(base, { status: 'found', provider: GMAIL, message: 'Serveur trouvé : Gmail (smtp.gmail.com).' });
  expect(screen.getByRole('status')).toHaveTextContent('Serveur trouvé : Gmail (smtp.gmail.com). Retenu à l’enregistrement.');
  expect(screen.getByText('Un mot de passe d’application Google (16 lettres).')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réglages avancés' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('Mot de passe manquant.')).toBeInTheDocument();
});

test('rule 28: not found — the card says it and opens the server field', () => {
  draw(base, { status: 'missing', provider: null, message: 'Fournisseur non reconnu pour domainesolio.com : saisir le serveur.' });
  expect(screen.getByRole('status')).toHaveTextContent('Fournisseur non reconnu pour domainesolio.com : saisir le serveur.');
  expect(screen.getByRole('button', { name: 'Réglages avancés' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByLabelText('Serveur d’envoi')).toBeVisible();
});

test('rule 28: a saved host wins over any proposal', () => {
  draw({ ...base, host: 'mail.perso.fr', passwordSet: true }, { status: 'found', provider: GMAIL, message: 'Serveur trouvé : Gmail (smtp.gmail.com).' });
  expect(screen.getByRole('status')).toHaveTextContent('Serveur d’envoi : mail.perso.fr.');
  expect(screen.queryByText(/Serveur trouvé/)).toBeNull();
  expect(screen.getByRole('button', { name: /Envoyer un mail de test/ })).toBeEnabled();
});

test('rule 28: while looking, the card says so; a found server waits for the save before the test', () => {
  const { unmount } = draw(base, { status: 'loading', provider: null, message: '' });
  expect(screen.getByRole('status')).toHaveTextContent('Recherche du serveur d’envoi…');
  unmount();
  draw({ ...base, passwordSet: true }, { status: 'found', provider: GMAIL, message: 'Serveur trouvé : Gmail (smtp.gmail.com).' });
  expect(screen.getByText('À enregistrer d’abord.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Envoyer un mail de test/ })).toBeDisabled();
});
