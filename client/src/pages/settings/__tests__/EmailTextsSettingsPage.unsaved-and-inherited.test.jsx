// specs/guest-email-texts-made-simple.md rule 35 — typed sentences are not lost: the menu, « Retour »
// and a link inside the page all ask first; a property's own text left empty reads « Texte commun
// utilisé » with the shared text, never « Vide »; on a phone the title is « Textes ».
import { vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => navigate }));
vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getEmailTexts: vi.fn(), saveEmailTexts: vi.fn(), getEmailReadiness: vi.fn(), previewEmailDraft: vi.fn(),
    getEmailMentions: vi.fn(), getOptions: vi.fn(),
  },
}));
vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import EmailTextsSettingsPage from '../EmailTextsSettingsPage';
import { TEXTS, PREVIEW, renderAt } from './emailTextsFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTexts.mockResolvedValue(TEXTS);
  api.getEmailReadiness.mockResolvedValue({ items: [], soonCount: 0 });
  api.previewEmailDraft.mockResolvedValue(PREVIEW);
});

async function typeInHouse() {
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Dans le logement' }));
  fireEvent.change(await screen.findByDisplayValue('Café offert.'), { target: { value: 'Café et thé offerts.' } });
}

test('rule 35: the menu asks before leaving with unsaved texts', async () => {
  renderAt(EmailTextsSettingsPage);
  await typeInHouse();
  expect(window.__guestflowBeforeNavigate('/planning')).toBe(true);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Des textes ne sont pas enregistrés. Quitter sans enregistrer ?')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Quitter sans enregistrer' }));
  expect(navigate).toHaveBeenCalledWith('/planning');
});

test('rule 35: « Retour » and a link inside the page ask too; nothing typed, nothing asked', async () => {
  renderAt(EmailTextsSettingsPage);
  fireEvent.click(await screen.findByRole('button', { name: 'Retour' }));
  expect(navigate).toHaveBeenCalledWith('/settings/emails');
  navigate.mockClear();

  await typeInHouse();
  fireEvent.click(screen.getByRole('button', { name: 'Retour' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rester' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  fireEvent.click(screen.getByRole('link', { name: 'Noms des options et des ressources : Traductions' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Café et thé offerts.')).toBeInTheDocument();
});

test('rule 35: an empty property text reads « Texte commun utilisé » with the shared text', async () => {
  const own = { key: 'ptext:house:1', kind: 'text', label: 'Dans le logement — Le Gîte', fr: '', en: '', placeholderFr: 'Café offert.', placeholderEn: '', chips: { variables: [], conditions: [] } };
  const sections = TEXTS.sections.map((s) => (s.id === 'j2' ? { ...s, items: [...s.items, own] } : s));
  api.getEmailTexts.mockResolvedValue({ ...TEXTS, sections });
  renderAt(EmailTextsSettingsPage);
  const row = await screen.findByRole('button', { name: 'Modifier Dans le logement — Le Gîte' });
  expect(row).toHaveTextContent('Texte commun utilisé : Café offert.');
  expect(row).not.toHaveTextContent('Vide');
  fireEvent.click(row);
  expect((await screen.findAllByText('Vide : texte commun utilisé')).length).toBeGreaterThan(0);
});

test('rule 35: on a phone the bar reads « Textes », its buttons on one row', async () => {
  renderAt(EmailTextsSettingsPage);
  expect(await screen.findByText('Textes')).toBeInTheDocument();
  expect(screen.queryByText('Textes des emails', { selector: '.MuiTypography-pageTitle' })).toBeNull();
});
