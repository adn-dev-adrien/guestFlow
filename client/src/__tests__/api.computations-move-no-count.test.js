// specs/inte-performance.md rule 17 — a POST that only computes or previews writes nothing, so it does
// not tell the pages their counts moved (the side menu re-reads /properties on that event).
import { vi } from 'vitest';
import api from '../api';
import { DATA_CHANGED_EVENT } from '../constants/appEvents';

beforeEach(() => { vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))); });
afterEach(() => { vi.unstubAllGlobals(); });

const COMPUTATIONS = [
  ['calculatePrice', [{}]], ['suggestBeds', [{}]], ['computePlatformCommission', [{}]], ['previewMidStayNote', [{}]],
  ['previewTerms', [{}]], ['previewEmailDraft', [{}]], ['previewProgressivePricing', [1, {}]], ['describeTemplateWhen', [{}]],
  ['parseClientContact', [{}]], ['detectSmtp', ['a@b.fr']],
];

test.each(COMPUTATIONS)('rule 17: %s does not announce a data change', async (name, args) => {
  const seen = vi.fn();
  window.addEventListener(DATA_CHANGED_EVENT, seen);
  try {
    await api[name](...args);
  } finally {
    window.removeEventListener(DATA_CHANGED_EVENT, seen);
  }
  expect(seen).not.toHaveBeenCalled();
});

test('rule 17: a real write still announces it', async () => {
  const seen = vi.fn();
  window.addEventListener(DATA_CHANGED_EVENT, seen);
  try {
    await api.createClient({});
  } finally {
    window.removeEventListener(DATA_CHANGED_EVENT, seen);
  }
  expect(seen).toHaveBeenCalledTimes(1);
});
