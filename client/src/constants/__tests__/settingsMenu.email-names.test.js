// specs/settings-rationalization.md rule 29 — the settings search finds « Textes des emails » by the
// names the emails carry everywhere since guest-email-texts-made-simple, never by « J-2 ».
import { SETTINGS_KEYWORDS } from '../settingsMenu';
import { EMAIL_DISPLAY_NAMES } from '../emailNames';
import { matchSettingsRow } from '../../utils/settingsSearch';

const textes = { label: 'Textes des emails', line: '', keywords: SETTINGS_KEYWORDS['/settings/emails/textes'] };

test('rule 29: every email name is a keyword of « Textes des emails »; the old codes are gone', () => {
  Object.values(EMAIL_DISPLAY_NAMES).forEach((name) => expect(textes.keywords).toContain(name));
  expect(textes.keywords).not.toContain('J-2');
  expect(textes.keywords).not.toContain('J-7');
});

test.each([
  ['accès', 'Accès et arrivée'],
  ['préparation', 'Préparation du séjour'],
  ['merci', 'Merci et avis'],
  ['rappel de solde', 'Rappel de solde'],
  ['acompte', 'Demande d’acompte'],
])('rule 29: « %s » finds « Textes des emails »', (query, keyword) => {
  const hit = matchSettingsRow(textes, query);
  expect(hit).not.toBeNull();
  expect(hit.keyword).toBe(keyword);
});
