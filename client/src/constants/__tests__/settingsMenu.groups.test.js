// specs/settings-rationalization.md rule 26 (UI/UX review 2026-10-18, decision 12) — the submenu
// becomes four groups, the families of SETTINGS_MENU; every entry (plugins' included) belongs to one;
// the group of the open page is the one the sidebar unfolds.
import {
  SETTINGS_MENU, SETTINGS_GROUPS, visibleSettingsGroups, settingsGroupOf, isSettingsPath, SETTINGS_KEYWORDS, INTEGRATIONS_PATH,
} from '../settingsMenu';

const all = () => true;

test('rule 26: four groups, in the order of the four families', () => {
  expect(SETTINGS_GROUPS.map((g) => g.label)).toEqual(['Établissement', 'Séjours', 'Paiements et emails', 'Compte et système']);
  expect(SETTINGS_MENU.filter((e) => e === null)).toHaveLength(SETTINGS_GROUPS.length - 1);
});

test('rule 26: every entry, the plugins’ included, lands in a group, by the family it sits in', () => {
  const groups = visibleSettingsGroups(all, all);
  const byGroup = Object.fromEntries(groups.map((g) => [g.id, g.entries.map((e) => e.path)]));
  expect(byGroup.etablissement).toEqual(['/settings/etablissement', '/properties', '/settings/plateformes', '/parametres/conditions-generales']);
  expect(byGroup.sejours).toEqual(['/parametres/options-ressources', '/parametres/recettes', '/parametres/vacances-fermetures', '/parametres/stock-blanchisserie']);
  expect(byGroup['paiements-emails']).toEqual(['/parametres/paiements', '/settings/tva-exercice', '/settings/emails']);
  expect(byGroup['compte-systeme']).toEqual(['/settings/utilisateurs', '/parametres/acces-support', '/settings/integrations', '/settings/systeme', '/parametres/plugins']);
  const listed = groups.flatMap((g) => g.entries.map((e) => e.path)).sort();
  expect(listed).toEqual(SETTINGS_MENU.filter(Boolean).map((e) => e.path).sort());
});

test('rule 26: a group with no visible page is left out; the summary adds its own rows', () => {
  const groups = visibleSettingsGroups((p) => p === '/settings/systeme' || p === '/settings/emails', () => false, { withExtras: true });
  expect(groups.map((g) => g.id)).toEqual(['paiements-emails', 'compte-systeme']);
  expect(groups[0].entries.map((e) => e.label)).toEqual(['Emails & notifications', 'Textes des emails']);
  expect(groups[1].entries.map((e) => e.label)).toEqual(['Système']);
  const withAccount = visibleSettingsGroups(all, all, { withExtras: true });
  expect(withAccount.at(-1).entries.at(-1).label).toBe('Mon compte');
});

test('rule 26: the group the sidebar unfolds — the open page’s, or the summary’s #group', () => {
  expect(settingsGroupOf('/settings/emails/textes')).toBe('paiements-emails');
  expect(settingsGroupOf('/properties/3')).toBe('etablissement');
  expect(settingsGroupOf('/school-holidays')).toBe('sejours');
  expect(settingsGroupOf('/settings', '#sejours')).toBe('sejours');
  expect(settingsGroupOf('/settings', '')).toBeNull();
  expect(settingsGroupOf('/settings', '#nimporte')).toBeNull();
  expect(settingsGroupOf('/planning')).toBeNull();
  expect(isSettingsPath('/settings')).toBe(true);
});

// Intégrations takes its words from its plugins' contributions (specs/integrations-tab-per-plugin.md rule 8).
test('rule 27: every page of the summary has its words', () => {
  visibleSettingsGroups(all, all, { withExtras: true }).flatMap((g) => g.entries)
    .filter((e) => e.path !== INTEGRATIONS_PATH)
    .forEach((e) => {
      expect(SETTINGS_KEYWORDS[e.path], e.path).toBeTruthy();
    });
});
