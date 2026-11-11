// specs/plugins-phase-2-hosts.md rules 5-6 — the module contributes the laundry card and the extra-trip
// button. (The load itself is pinned by planningDays.days-endpoint.test.js.)
import linen from '..';

test('specs/plugins-phase-2-hosts.md rules 5-6: the module contributes the laundry card and the extra-trip button', () => {
  const [days] = linen.contributes['planning.days'];
  expect(days.rank).toBeGreaterThan(0);
  expect(days.errorMessage).toBe("Le linge n'a pas pu être chargé.");
  expect(linen.contributes['planning.actions']).toHaveLength(1);
  expect(linen.contributes.routes[0].path).toBe('/parametres/stock-blanchisserie');
  expect(linen.contributes['dashboard.alerts'][0].key).toBe('linen-shortage');
});
