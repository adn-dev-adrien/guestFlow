// specs/settings-rationalization.md rule 28 — what the Envoi card hears from the server: a provider
// found, a sentence to show (not found, not supported), or nothing at all when the lookup is off or
// the request refused (a read-only instance never reads « Serveur introuvable »).
import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { detectSmtp: vi.fn() } }));

import api from '../../api';
import useSmtpDetection from '../useSmtpDetection';

const GMAIL = { id: 'google', name: 'Gmail', host: 'smtp.gmail.com', secure: true, port: 465, hint: 'h' };

beforeEach(() => api.detectSmtp.mockReset());

test('rule 28: found, with the provider', async () => {
  api.detectSmtp.mockResolvedValue({ found: true, provider: GMAIL, message: 'Serveur trouvé : Gmail (smtp.gmail.com).' });
  const { result } = renderHook(() => useSmtpDetection('a@gmail.com', true, { delayMs: 0 }));
  await waitFor(() => expect(result.current.status).toBe('found'));
  expect(result.current.provider.host).toBe('smtp.gmail.com');
});

test('rule 28: not supported or not found — the server’s sentence', async () => {
  api.detectSmtp.mockResolvedValue({ found: false, provider: null, message: 'Outlook, Hotmail et Live demandent l’authentification moderne : l’envoi par mot de passe n’est pas pris en charge.' });
  const { result } = renderHook(() => useSmtpDetection('a@hotmail.fr', true, { delayMs: 0 }));
  await waitFor(() => expect(result.current.status).toBe('missing'));
  expect(result.current.message).toMatch(/authentification moderne/);
});

test('rule 28: lookup off — nothing said', async () => {
  api.detectSmtp.mockResolvedValue({ found: false, provider: null, message: '' });
  const { result } = renderHook(() => useSmtpDetection('a@gite.fr', true, { delayMs: 0 }));
  await waitFor(() => expect(api.detectSmtp).toHaveBeenCalled());
  await waitFor(() => expect(result.current.status).toBe('idle'));
});

test('rule 28: request refused (read-only instance) — nothing said', async () => {
  // A plain function, not a spy: the spy's own bookkeeping of a rejected promise is reported apart.
  const spy = api.detectSmtp;
  let asked = 0;
  api.detectSmtp = async () => { asked += 1; throw Object.assign(new Error('Instance en lecture seule'), { status: 403 }); };
  try {
    const { result } = renderHook(() => useSmtpDetection('b@gite.fr', true, { delayMs: 0 }));
    await waitFor(() => expect(asked).toBe(1));
    await waitFor(() => expect(result.current.status).toBe('idle'));
  } finally {
    api.detectSmtp = spy;
  }
});

test('rule 28: not enabled (a managed instance sending through the platform) — no request', async () => {
  renderHook(() => useSmtpDetection('a@gite.fr', false, { delayMs: 0 }));
  await new Promise((r) => setTimeout(r, 20));
  expect(api.detectSmtp).not.toHaveBeenCalled();
});
