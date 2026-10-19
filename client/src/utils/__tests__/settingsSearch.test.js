// specs/settings-rationalization.md rule 27 — the summary's search: every word must be found in the
// name, the state line or a keyword; accents, case and punctuation ignored; the keyword that matched
// is said.
import { matchSettingsRow, normalize } from '../settingsSearch';

const logements = { label: 'Logements', line: '2 logements', keywords: ['Wi-Fi', 'Caution', 'Code de la boîte à clés'] };
const compte = { label: 'Mon compte', line: 'Second code non activé', keywords: ['Mot de passe', '2FA'] };
const emails = { label: 'Emails & notifications', line: 'Envoi non configuré', keywords: ['SMTP', 'Gmail'] };
const banque = { label: 'Établissement', line: 'Domaine Solio', keywords: ['IBAN', 'SIRET'] };

test('rule 27: wifi, iban, smtp, 2fa find their page and say the word', () => {
  expect(matchSettingsRow(logements, 'wifi')).toEqual({ keyword: 'Wi-Fi' });
  expect(matchSettingsRow(banque, 'IBAN')).toEqual({ keyword: 'IBAN' });
  expect(matchSettingsRow(emails, 'smtp')).toEqual({ keyword: 'SMTP' });
  expect(matchSettingsRow(compte, '2fa')).toEqual({ keyword: '2FA' });
});

test('rule 27: accents and case ignored; a name match needs no keyword', () => {
  expect(matchSettingsRow(banque, 'etablis')).toEqual({ keyword: null });
  expect(matchSettingsRow(logements, 'boite')).toEqual({ keyword: 'Code de la boîte à clés' });
  expect(matchSettingsRow(emails, 'non configure')).toEqual({ keyword: null });
});

test('rule 27: every word must match; an empty query matches all; nonsense matches nothing', () => {
  expect(matchSettingsRow(logements, 'wifi caution')).not.toBeNull();
  expect(matchSettingsRow(logements, 'wifi iban')).toBeNull();
  expect(matchSettingsRow(logements, '   ')).toEqual({ keyword: null });
  expect(matchSettingsRow(compte, 'zzz')).toBeNull();
  expect(normalize('Wi-Fi  Côte')).toBe('wi fi cote');
});
