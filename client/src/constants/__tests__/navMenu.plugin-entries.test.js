// The side menu's `nav.items` slot (specs/plugins-phase-1-sdk.md rules 13, 49): a plugin page drawn after the core entry
// it names, else after « Calendrier », the end of the day-to-day group.
import { withPluginEntries } from '../navMenu';

const CORE = [
  { label: 'Tableau de bord', path: '/' },
  { label: 'Planning', path: '/planning' },
  { label: 'Calendrier', path: '/calendar' },
  { label: 'Paramètres', path: '/settings' },
];
const Icon = () => null;

test('an entry anchored on a core path comes right after it', () => {
  const items = withPluginEntries(CORE, [{ path: '/a', label: 'A', Icon, after: '/planning' }]);
  expect(items.map((i) => i.path)).toEqual(['/', '/planning', '/a', '/calendar', '/settings']);
  expect(items[2].icon).not.toBeNull();
});

test('an entry without a known anchor closes the day-to-day group, after « Calendrier »', () => {
  const items = withPluginEntries(CORE, [{ path: '/b', label: 'B', after: '/nowhere' }]);
  expect(items.map((i) => i.path)).toEqual(['/', '/planning', '/calendar', '/b', '/settings']);
});

test('no plugin entry → the core menu unchanged', () => {
  expect(withPluginEntries(CORE, [])).toEqual(CORE);
});
