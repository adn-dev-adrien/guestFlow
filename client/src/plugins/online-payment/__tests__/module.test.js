// specs/plugins-phase-3a-online-payment.md rule 17 — the Paiements page and its menu entry are the
// online-payment module's: the entry opens the family it always opened, right before « TVA & exercice ».
import { SETTINGS_MENU } from '../../../constants/settingsMenu';
import { ROUTE_PLUGINS, MODULE_ROUTE_ROLES } from '../../../constants/plugins';

test('the entry sits right after the divider, before « TVA & exercice »', () => {
  const at = SETTINGS_MENU.findIndex((e) => e && e.path === '/parametres/paiements');
  expect(at).toBeGreaterThan(0);
  expect(SETTINGS_MENU[at - 1]).toBeNull();
  expect(SETTINGS_MENU[at + 1].path).toBe('/settings/tva-exercice');
  expect(SETTINGS_MENU[at].label).toBe('Paiements en ligne');
});

test('the page belongs to the module, for the admin only', () => {
  expect(ROUTE_PLUGINS['/parametres/paiements']).toBe('online-payment');
  expect(MODULE_ROUTE_ROLES['/parametres/paiements']).toEqual(['admin']);
});
