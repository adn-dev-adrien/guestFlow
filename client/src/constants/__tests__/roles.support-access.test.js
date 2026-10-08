// specs/hosting-h2-account-security.md rules 15 and 17 — Paramètres › Accès du support exists for an
// administrator of a managed instance only: the server says so in `/auth/me` (`supportAccessEnabled`).
import { describe, expect, test } from 'vitest';
import { canSeeRoute } from '../roles';
import { visibleSettingsMenu } from '../settingsMenu';

const PATH = '/parametres/acces-support';

describe('Accès du support', () => {
  test('rule 17 — hidden on an instance without a licence key', () => {
    expect(canSeeRoute({ roles: ['admin'], enabledPlugins: [], supportAccessEnabled: false }, PATH)).toBe(false);
    const menu = visibleSettingsMenu((p) => canSeeRoute({ roles: ['admin'], enabledPlugins: [] }, p));
    expect(menu.filter(Boolean).map((e) => e.path)).not.toContain(PATH);
  });

  test('rule 15 — listed for an administrator of a managed instance, never for another role', () => {
    expect(canSeeRoute({ roles: ['admin'], enabledPlugins: [], supportAccessEnabled: true }, PATH)).toBe(true);
    expect(canSeeRoute({ roles: ['accountant'], enabledPlugins: [], supportAccessEnabled: true }, PATH)).toBe(false);
    const menu = visibleSettingsMenu((p) => canSeeRoute({ roles: ['admin'], enabledPlugins: [], supportAccessEnabled: true }, p));
    expect(menu.filter(Boolean).map((e) => e.label)).toContain('Accès du support');
  });
});
