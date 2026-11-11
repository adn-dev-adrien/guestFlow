// specs/inte-performance.md rule 14 — the reservation fiche asks for the property's `stay` view.
import { vi } from 'vitest';
import api from '../api';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))); });
afterEach(() => { vi.unstubAllGlobals(); });

test('rule 14: getProperty asks the full detail by default and the stay view on request', async () => {
  await api.getProperty(4);
  expect(fetch.mock.calls[0][0]).toBe('/api/properties/4');
  await api.getProperty(4, 'stay');
  expect(fetch.mock.calls[1][0]).toBe('/api/properties/4?view=stay');
});

test('rule 16: the pickers ask the email list without the bodies, the plain call is unchanged', async () => {
  await api.getEmailTemplates();
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/email-templates');
  await api.getEmailTemplates('picker');
  expect(fetch.mock.calls.at(-1)[0]).toBe('/api/email-templates?view=picker');
});
