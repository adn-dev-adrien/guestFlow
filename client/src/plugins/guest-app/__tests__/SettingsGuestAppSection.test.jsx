// specs/guest-app.md plan step 5 — the « Application clients » card of Paramètres › Intégrations.
import React, { createRef } from 'react';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const api = vi.hoisted(() => ({ getPluginSettings: vi.fn(), savePluginSettings: vi.fn() }));
vi.mock('../../sdk', () => ({ api }));

import SettingsGuestAppSection from '../SettingsGuestAppSection';

const FIELD = 'Adresse de l’application';

beforeEach(() => {
  api.getPluginSettings.mockReset().mockResolvedValue({ guestHost: 'sejour.example.test' });
  api.savePluginSettings.mockReset().mockResolvedValue({});
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
  expect(api.savePluginSettings).toHaveBeenCalledWith('guest-app', { guestHost: 'app.example.test' });
  expect(ref.current.isDirty()).toBe(false);
});

test('a refused address keeps the draft and shows the server message on the field', async () => {
  const refusal = Object.assign(new Error('refused'), { errors: { guestHost: 'Saisissez un nom de domaine.' } });
  api.savePluginSettings.mockRejectedValue(refusal);
  const ref = createRef();
  render(<SettingsGuestAppSection ref={ref} />);
  await waitFor(() => expect(screen.getByLabelText(FIELD)).toHaveValue('sejour.example.test'));
  fireEvent.change(screen.getByLabelText(FIELD), { target: { value: 'pas un domaine' } });
  await act(async () => { await expect(ref.current.save()).rejects.toBe(refusal); });
  expect(screen.getByText('Saisissez un nom de domaine.')).toBeInTheDocument();
  expect(screen.getByLabelText(FIELD)).toHaveValue('pas un domaine');
});
