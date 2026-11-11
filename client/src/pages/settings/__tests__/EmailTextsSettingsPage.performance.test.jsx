// specs/guest-email-texts-made-simple.md rules 50–52 (specs/inte-performance.md lot 1): the first preview
// does not wait for the typing debounce, a folded section's fields are not mounted, and each section's
// « Email » selector holds its own email.
import { vi } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getEmailTexts: vi.fn(), saveEmailTexts: vi.fn(), getEmailReadiness: vi.fn(), previewEmailDraft: vi.fn(), sendTestEmail: vi.fn(),
  },
}));
vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import EmailTextsSettingsPage from '../EmailTextsSettingsPage';
import { TEXTS, PREVIEW, SECTIONS, renderAt } from './emailTextsFixtures';

const twoEmails = (id, names) => ({
  id, title: `Section ${id}`, when: '', items: [],
  templates: names.map((name, i) => ({ id: `${id}-${i}`, stableKey: `${id}_${i}`, name })),
});
const PAYMENT_TEXTS = {
  ...TEXTS,
  sections: [twoEmails('pay', ['Acompte', 'Solde']), twoEmails('stay', ['Pendant', 'Après']), SECTIONS[2]],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTexts.mockResolvedValue(TEXTS);
  api.getEmailReadiness.mockResolvedValue({ items: [], soonCount: 0 });
  api.previewEmailDraft.mockResolvedValue(PREVIEW);
});

async function opened() {
  renderAt(EmailTextsSettingsPage);
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Dans le logement' }));
  await screen.findByDisplayValue('Café offert.');
}

test('rule 50 — the preview is requested at once on open, with no timer advanced', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  try {
    renderAt(EmailTextsSettingsPage);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(api.previewEmailDraft).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test('rule 50 — opening another section requests its preview at once', async () => {
  await opened();
  api.previewEmailDraft.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: false });
  try {
    fireEvent.click(screen.getByRole('button', { name: /Préparation du séjour/ }));
    expect(api.previewEmailDraft).toHaveBeenCalledTimes(1);
    expect(api.previewEmailDraft).toHaveBeenLastCalledWith(expect.objectContaining({ templateId: 1 }));
  } finally {
    vi.useRealTimers();
  }
});

test('rule 50 — a reload after a save renders at once, a draft cleared by the save does not wait', async () => {
  await opened();
  const field = screen.getByDisplayValue('Café offert.');
  fireEvent.change(field, { target: { value: 'Thé.' } });
  await waitFor(() => expect(api.previewEmailDraft).toHaveBeenLastCalledWith(
    expect.objectContaining({ draft: { texts: { 'text:house': { fr: 'Thé.' } } } }),
  ), { timeout: 2000 });
  api.saveEmailTexts.mockResolvedValue({});
  api.previewEmailDraft.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: false });
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(api.saveEmailTexts).toHaveBeenCalled();
    expect(api.previewEmailDraft).toHaveBeenCalledWith(expect.objectContaining({ draft: { texts: {} } }));
  } finally {
    vi.useRealTimers();
  }
});

test('rule 50 — typing still waits 400 ms and a burst sends once (rule 13)', async () => {
  await opened();
  const field = screen.getByDisplayValue('Café offert.');
  await waitFor(() => expect(api.previewEmailDraft).toHaveBeenCalled());
  api.previewEmailDraft.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: false });
  try {
    fireEvent.change(field, { target: { value: 'T' } });
    fireEvent.change(field, { target: { value: 'Th' } });
    fireEvent.change(field, { target: { value: 'Thé' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(399); });
    expect(api.previewEmailDraft).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(api.previewEmailDraft).toHaveBeenCalledTimes(1);
    expect(api.previewEmailDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ draft: { texts: { 'text:house': { fr: 'Thé' } } } }),
    );
  } finally {
    vi.useRealTimers();
  }
});

test('rule 51 — a folded section has no field in the page, opening it mounts them', async () => {
  const mounted = (label) => document.querySelector(`[aria-label="Modifier ${label}"]`) !== null;
  renderAt(EmailTextsSettingsPage);
  await screen.findByRole('button', { name: 'Modifier Dans le logement' });
  expect(mounted('Produits locaux — introduction')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /Préparation du séjour/ }));
  expect(await screen.findByRole('button', { name: 'Modifier Produits locaux — introduction' })).toBeInTheDocument();
  await waitFor(() => expect(mounted('Dans le logement')).toBe(false));
});

test('rule 52 — a section selector shows its own email and never an out-of-range value', async () => {
  api.getEmailTexts.mockResolvedValue(PAYMENT_TEXTS);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    renderAt(EmailTextsSettingsPage, '/settings/emails/textes#pay');
    expect(await screen.findByRole('combobox', { name: 'Email' })).toHaveTextContent('Acompte');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Email' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Solde' }));
    expect(screen.getByRole('combobox', { name: 'Email' })).toHaveTextContent('Solde');
    fireEvent.click(screen.getByRole('button', { name: /Section stay/ }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Email' })).toHaveTextContent('Pendant'));
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('out-of-range'))).toHaveLength(0);
  } finally {
    warn.mockRestore();
  }
});
