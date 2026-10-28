// specs/hosting-h2-account-security.md rule 47 — the re-authentication dialog: both fields when a code
// is needed, « Recevoir un code » for the email method with its countdown, and the server's refusal
// where it belongs.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { apiError } from './twoFactorFixtures';
import ReauthDialog from '../ReauthDialog';

afterEach(() => { vi.useRealTimers(); });

const base = { open: true, onClose: () => {}, title: 'Désactiver', submitLabel: 'Désactiver' };

test('rule 47: with a code needed, the submit waits for the password AND a complete code, and sends both', async () => {
  const onSubmit = vi.fn().mockResolvedValue();
  render(<ReauthDialog {...base} needsCode onSubmit={onSubmit} />);
  const submit = screen.getByRole('button', { name: 'Désactiver' });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '12345' } });
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '123456' } });
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ password: 'secret', code: '123456' }));
  expect(screen.getByRole('button', { name: 'Utiliser un code de secours' })).toBeInTheDocument();
});

test('rule 47: the 6th digit sends the code when the password is filled, and not before; the button still works', async () => {
  const onSubmit = vi.fn().mockResolvedValue();
  render(<ReauthDialog {...base} needsCode onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '123456' } });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  const submit = screen.getByRole('button', { name: 'Désactiver' });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ password: 'secret', code: '123456' }));
});

test('rule 47: « Vérification… » shows while the code is checked, and the field stays focusable (readOnly)', async () => {
  let release;
  const onSubmit = vi.fn(() => new Promise((resolve) => { release = resolve; }));
  render(<ReauthDialog {...base} needsCode onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '123456' } });
  expect(await screen.findByText('Vérification…')).toBeInTheDocument();
  expect(screen.getByLabelText('Code à 6 chiffres')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Code à 6 chiffres')).not.toBeDisabled();
  await act(async () => { release(); });
  expect(screen.queryByText('Vérification…')).toBeNull();
});

test('rule 47: an email-method account reads « Code reçu par email » and « Utiliser le code reçu par email »', () => {
  render(<ReauthDialog {...base} needsCode onSendCode={vi.fn()} onSubmit={vi.fn()} />);
  expect(screen.getByLabelText('Code reçu par email')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Utiliser un code de secours' }));
  expect(screen.getByRole('button', { name: 'Utiliser le code reçu par email' })).toBeInTheDocument();
});

test('rules 47, 49, 57: a lock disables the submit, shows « dans N min » following the countdown, then opens again', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onSubmit = vi.fn().mockRejectedValue(apiError('REAUTH_LOCKED', 'Trop d’essais : réessayer après 14:32 (dans 3 min).', { retryInSeconds: 150, retryAtLabel: '14:32' }));
  render(<ReauthDialog {...base} needsCode onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '123456' } });
  expect(await screen.findByText(/^Trop d’essais : réessayer après 14:32 \(dans \d+ min\)\.$/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Désactiver' })).toBeDisabled();
  for (let i = 0; i < 100; i += 1) await act(async () => { vi.advanceTimersByTime(1000); });
  expect(screen.getByText(/^Trop d’essais : réessayer après 14:32 \(dans \d+ s\)\.$/)).toBeInTheDocument();
  for (let i = 0; i < 60; i += 1) await act(async () => { vi.advanceTimersByTime(1000); });
  expect(screen.queryByText(/Trop d’essais/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Désactiver' })).toBeEnabled();
});

test('rule 47: a wrong code shows the tries left the server worded', async () => {
  const onSubmit = vi.fn().mockRejectedValue(apiError('BAD_CODE', 'Code incorrect : 3 essais restants.', { attemptsLeft: 3 }));
  render(<ReauthDialog {...base} needsCode onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '000000' } });
  expect((await screen.findByText('Code incorrect : 3 essais restants.')).getAttribute('role')).toBe('alert');
});

test('rule 47: without a code needed, only the password is asked and no code is sent', async () => {
  const onSubmit = vi.fn().mockResolvedValue();
  render(<ReauthDialog {...base} onSubmit={onSubmit} />);
  expect(screen.queryByLabelText('Code à 6 chiffres')).toBeNull();
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Désactiver' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ password: 'secret', code: undefined }));
});

test('rule 47: « Recevoir un code » asks the server, names the address and counts down before a resend', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onSendCode = vi.fn().mockResolvedValue({ sentTo: 'm•••e@x.fr', resendInSeconds: 60 });
  render(<ReauthDialog {...base} needsCode onSendCode={onSendCode} onSubmit={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Recevoir un code' }));
  expect(await screen.findByText('Code envoyé à m•••e@x.fr.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Renvoyer le code (60 s)' })).toBeDisabled();
  for (let i = 0; i < 60; i += 1) await act(async () => { vi.advanceTimersByTime(1000); });
  expect(screen.getByRole('button', { name: 'Renvoyer le code' })).toBeEnabled();
});

test('rule 47: a send refused too early shows the server\'s sentence and keeps the countdown it gave', async () => {
  const onSendCode = vi.fn().mockRejectedValue(apiError('RESEND_TOO_SOON', 'Nouvel envoi possible dans 42 s.', { retryInSeconds: 42 }));
  render(<ReauthDialog {...base} needsCode onSendCode={onSendCode} onSubmit={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Recevoir un code' }));
  expect(await screen.findByText('Nouvel envoi possible dans 42 s.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Recevoir un code \(4\d s\)/ })).toBeDisabled();
});

test('rule 47: nothing is sent twice while a submit is in flight', async () => {
  let release;
  const onSubmit = vi.fn(() => new Promise((resolve) => { release = resolve; }));
  render(<ReauthDialog {...base} needsCode onSubmit={onSubmit} />);
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  fireEvent.change(screen.getByLabelText('Code à 6 chiffres'), { target: { value: '123456' } });
  fireEvent.keyDown(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { key: 'Enter' });
  fireEvent.keyDown(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { key: 'Enter' });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await act(async () => { release(); });
});
