// specs/plugins-phase-0-foundation.md rules 16-17, 21 — a page of an inactive plugin is not visible,
// whatever the role; the settings submenu drops the entries and the dividers left empty.
import { canSeeRoute, canSeeAnyRoute, ROUTE_ROLES } from '../roles';
import { PLUGIN_IDS, ROUTE_PLUGINS, isRouteEnabled, isPluginEnabled } from '../plugins';
import { visibleSettingsMenu, SETTINGS_MENU } from '../settingsMenu';

const admin = (enabledPlugins) => ({ roles: ['admin'], enabledPlugins });

describe('plugin gate on routes', () => {
  test('every plugin route is a registered route', () => {
    for (const path of Object.keys(ROUTE_PLUGINS)) expect(ROUTE_ROLES[path]).toBeDefined();
  });

  test('an admin without any plugin sees no plugin page, and every core page', () => {
    const user = admin([]);
    for (const path of Object.keys(ROUTE_ROLES)) {
      expect(canSeeRoute(user, path)).toBe(!ROUTE_PLUGINS[path]);
    }
  });

  test('a plugin page comes back with its plugin', () => {
    expect(canSeeRoute(admin(['linen']), '/parametres/stock-blanchisserie')).toBe(true);
    expect(canSeeRoute(admin(['linen']), '/parametres/recettes')).toBe(false);
  });

  test('Intégrations stays while any of its four plugins is active', () => {
    expect(canSeeRoute(admin([]), '/settings/integrations')).toBe(false);
    for (const id of ['google-calendar', 'neat', 'weather-alerts', 'gate-access']) {
      expect(canSeeRoute(admin([id]), '/settings/integrations')).toBe(true);
    }
  });

  test('the accountant loses the accounting pages with the accounting export', () => {
    const accountant = { roles: ['accountant'], enabledPlugins: [] };
    expect(canSeeAnyRoute(accountant, ['/comptabilite', '/comptabilite/plateformes'])).toBe(false);
    expect(canSeeRoute(accountant, '/mon-compte')).toBe(true);
  });

  test('the Plugins page is admin-only and never gated by a plugin', () => {
    expect(canSeeRoute(admin([]), '/parametres/plugins')).toBe(true);
    expect(canSeeRoute({ roles: ['accountant'], enabledPlugins: PLUGIN_IDS }, '/parametres/plugins')).toBe(false);
  });

  test('a user without the list sees no plugin (fail closed)', () => {
    expect(isPluginEnabled({ roles: ['admin'] }, 'sas')).toBe(false);
    expect(isRouteEnabled({ roles: ['admin'] }, '/resource-planning')).toBe(false);
    expect(isRouteEnabled(null, '/calendar')).toBe(true);
  });
});

describe('visibleSettingsMenu', () => {
  const paths = (entries) => entries.map((e) => (e ? e.path : '—'));

  test('with every entry visible it is the full menu', () => {
    expect(visibleSettingsMenu(() => true)).toEqual(SETTINGS_MENU);
  });

  test('without plugins: no plugin entry, no leading, trailing or doubled divider', () => {
    const user = admin([]);
    const menu = paths(visibleSettingsMenu((path) => canSeeRoute(user, path)));
    for (const hidden of ['/parametres/recettes', '/parametres/stock-blanchisserie', '/parametres/paiements', '/settings/integrations']) {
      expect(menu).not.toContain(hidden);
    }
    expect(menu).toContain('/parametres/plugins');
    expect(menu[0]).not.toBe('—');
    expect(menu[menu.length - 1]).not.toBe('—');
    menu.forEach((p, i) => { if (p === '—') expect(menu[i + 1]).not.toBe('—'); });
  });

  test('a family emptied out loses its divider', () => {
    const menu = paths(visibleSettingsMenu((path) => path === '/settings/etablissement' || path === '/settings/systeme'));
    expect(menu).toEqual(['/settings/etablissement', '—', '/settings/systeme']);
  });
});
