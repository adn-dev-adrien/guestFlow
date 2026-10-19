// specs/ui-review-2026-10-19-operations.md rule 15 — at-a-glance surfaces print a name, not a key.
import { platformDisplayName } from '../platforms';

test('rule 15 — « Gîtes de France », « GreenGo »; every other platform as formatPlatformLabel prints it', () => {
  expect(platformDisplayName('GitesDeFrance')).toBe('Gîtes de France');
  expect(platformDisplayName('Gitedefrance')).toBe('Gîtes de France');
  expect(platformDisplayName('greengo')).toBe('GreenGo');
  expect(platformDisplayName('direct')).toBe('Direct');
  expect(platformDisplayName('abracadaroom')).toBe('Abracadaroom');
  expect(platformDisplayName('')).toBe('');
});
