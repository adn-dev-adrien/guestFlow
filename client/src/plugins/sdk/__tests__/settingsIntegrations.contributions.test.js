// specs/integrations-tab-per-plugin.md rules 4 and 8 — every plugin that contributes to Intégrations
// names its tab with a short label and brings the search words that lead to it.
import { allContributions } from '../registry';
import { shippedPlugins } from '../testing';

const sections = allContributions('settings.integrations');

test('rule 4: each contributing plugin declares a short tab label', () => {
  const byPlugin = new Map();
  sections.forEach((s) => { if (s.tabLabel) byPlugin.set(s.pluginId, s.tabLabel); });
  const expected = {
    'website-booking': 'Site',
    'google-calendar': 'Google Agenda',
    neat: 'Neat',
    'weather-alerts': 'Météo-France',
    'gate-access': 'Portail',
    'gites-de-france-intake': 'Gîtes de France',
    'booking-intake': 'Booking',
    'airbnb-intake': 'Airbnb',
    'google-vacation-rentals': 'Google Vacation Rentals',
  };
  const shipped = shippedPlugins();
  expect(Object.fromEntries(byPlugin)).toEqual(Object.fromEntries(Object.entries(expected).filter(([id]) => shipped.includes(id))));
});

test('rule 8: each contributing plugin brings its own search words, none shared', () => {
  const owners = new Map();
  sections.forEach((s) => {
    expect((s.keywords || []).length, s.pluginId).toBeGreaterThan(0);
    s.keywords.forEach((word) => {
      expect(owners.get(word) || s.pluginId, word).toBe(s.pluginId);
      owners.set(word, s.pluginId);
    });
  });
  if (owners.has('Neat')) expect(owners.get('Neat')).toBe('neat');
  if (owners.has('Sowel')) expect(owners.get('Sowel')).toBe('gate-access');
});
