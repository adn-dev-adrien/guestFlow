// specs/plugin-operator-provisioning.md rule 3 — on an operator-managed space the Plugins page does not
// exist: no menu entry, no route, no search words. The server says so in `/auth/me` (`pluginsManageable`).
import { describe, expect, test } from 'vitest';
import { canSeeRoute } from '../roles';
import { visibleSettingsGroups, visibleSettingsMenu, settingsKeywordsOf } from '../settingsMenu';

const PATH = '/parametres/plugins';
const admin = (pluginsManageable) => ({ roles: ['admin'], enabledPlugins: [], pluginsManageable });

describe('Paramètres › Plugins on an operator-managed space', () => {
  test('rule 3 — the route is refused, so the address reads « Page introuvable »', () => {
    expect(canSeeRoute(admin(false), PATH)).toBe(false);
    expect(canSeeRoute({ roles: ['admin'], enabledPlugins: [] }, PATH)).toBe(false);
    expect(canSeeRoute(admin(true), PATH)).toBe(true);
  });

  test('rule 3 — the menu has no Plugins entry, and the last entry becomes « Système »', () => {
    const managed = visibleSettingsMenu((p) => canSeeRoute(admin(false), p)).filter(Boolean);
    expect(managed.map((e) => e.path)).not.toContain(PATH);
    expect(managed[managed.length - 1].label).toBe('Système');
    const selfManaged = visibleSettingsMenu((p) => canSeeRoute(admin(true), p)).filter(Boolean);
    expect(selfManaged.map((e) => e.label)).toContain('Plugins');
  });

  test('rule 3 — the search words (« Plugin », « Extension », « Module »…) go with the entry', () => {
    const groups = visibleSettingsGroups((p) => canSeeRoute(admin(false), p));
    const entries = groups.flatMap((g) => g.entries);
    const words = entries.flatMap((e) => settingsKeywordsOf(e));
    ['Plugin', 'Extension', 'Module', 'Activer', 'Désactiver'].forEach((w) => expect(words).not.toContain(w));
  });
});
