// specs/guest-app.md plan step 5, rule 58 — the « Application clients » card of Paramètres › Intégrations, saved through
// the plugin's own settings route (the only one that writes the guest host).
import React, { createRef } from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const api = vi.hoisted(() => ({ getSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock('../guestAppApi', () => ({ default: api }));

import SettingsGuestAppSection from '../SettingsGuestAppSection';

const FIELD = 'Adresse de l’application';

beforeEach(() => {
  api.getSettings.mockReset().mockResolvedValue({ guestHost: 'sejour.example.test' });
  api.saveSettings.mockReset().mockResolvedValue({});
});

test('shows the stored address and stays clean until it is edited', async () => {
  const onDirty = vi.fn();
  render(<SettingsGuestAppSection onDirtyChange={onDirty} />);
  await waitFor(() => expect(screen.getByLabelText(FIELD)).toHaveValue('sejour.example.test'));
  expect(onDirty).toHaveBeenLastCalledWith(false);
  fireEvent.change(screen.getByLabelText(FIELD), { target: { value: 'app.example.test' } });
  expect(onDirty).toHaveBeenLastCalledWith(true);
});

test('the page bar saves the trimmed address through the ref', async () => {
  const ref = createRef();
  render(<SettingsGuestAppSection ref={ref} />);
  await waitFor(() => expect(screen.getByLabelText(FIELD)).toHaveValue('sejour.example.test'));
  fireEvent.change(screen.getByLabelText(FIELD), { target: { value: ' app.example.test ' } });
  await act(async () => { await ref.current.save(); });
  expect(api.saveSettings).toHaveBeenCalledWith({ guestHost: 'app.example.test' });
  expect(ref.current.isDirty()).toBe(false);
});

test('a refused address keeps the draft and shows the server message on the field', async () => {
  const refusal = Object.assign(new Error('refused'), { error: 'Saisir un nom de domaine.' });
  api.saveSettings.mockRejectedValue(refusal);
  const ref = createRef();
  render(<SettingsGuestAppSection ref={ref} />);
  await waitFor(() => expect(screen.getByLabelText(FIELD)).toHaveValue('sejour.example.test'));
  fireEvent.change(screen.getByLabelText(FIELD), { target: { value: 'pas un domaine' } });
  await act(async () => { await expect(ref.current.save()).rejects.toBe(refusal); });
  expect(screen.getByText('Saisir un nom de domaine.')).toBeInTheDocument();
  expect(screen.getByLabelText(FIELD)).toHaveValue('pas un domaine');
});

test('rule 47: « Ouvrir le Studio » opens the booklet studio in a new tab', async () => {
  render(<SettingsGuestAppSection />);
  const link = await screen.findByRole('link', { name: /Ouvrir le Studio/ });
  expect(link).toHaveAttribute('href', '/studio');
  expect(link).toHaveAttribute('target', '_blank');
});

test('the address field is typed as a URL: no capitals, no correction, no spell check', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<SettingsGuestAppSection />);
  const field = await screen.findByLabelText(FIELD);
  expect(field).toHaveAttribute('inputmode', 'url');
  expect(field).toHaveAttribute('autocapitalize', 'none');
  expect(field).toHaveAttribute('spellcheck', 'false');
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

test('rule 58: GuestFlow’s own address, refused by the server, is said on the field', async () => {
  const own = 'C’est l’adresse de GuestFlow : en choisir une autre, par exemple sejour.domainesolio.com.';
  api.saveSettings.mockRejectedValue(Object.assign(new Error(own), { error: own, field: 'guestHost' }));
  const ref = createRef();
  render(<SettingsGuestAppSection ref={ref} />);
  await waitFor(() => expect(screen.getByLabelText(FIELD)).toHaveValue('sejour.example.test'));
  fireEvent.change(screen.getByLabelText(FIELD), { target: { value: 'admin.example.test' } });
  await act(async () => { await expect(ref.current.save()).rejects.toBeTruthy(); });
  expect(screen.getByText(own)).toBeInTheDocument();
  expect(ref.current.isDirty()).toBe(true);
});
