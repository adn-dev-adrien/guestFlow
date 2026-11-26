// specs/platforms/platform-settings-relay-and-review.md rule 12 — one label per platform: the chip renders the
// display name the server serves (« Gîtes de France »), never the stored key « GitesDeFrance », and
// re-renders when the names arrive after it first drew (audit 2026-10-27).
import React from 'react';
import { act, render, screen } from '@testing-library/react';

import { vi } from 'vitest';

// The display names live in a module-level map that only grows: each test loads a fresh copy, so the
// « before the names load » case never sees names another test already set.
let PlatformChip;
let formatPlatformLabel;
let setPlatformDisplayNames;
beforeEach(async () => {
  vi.resetModules();
  ({ default: PlatformChip } = await import('../PlatformChip'));
  ({ formatPlatformLabel, setPlatformDisplayNames } = await import('../../constants/platforms'));
});

test('before the names load, the stored spelling; once loaded, the server display name', () => {
  render(<PlatformChip platform="GitesDeFrance" />);
  expect(screen.getByText('GitesDeFrance')).toBeInTheDocument();
  act(() => setPlatformDisplayNames({ GitesDeFrance: 'Gîtes de France', Greengo: 'GreenGo', direct: 'Direct' }));
  expect(screen.getByText('Gîtes de France')).toBeInTheDocument();
});

test('formatPlatformLabel reads the same name, whatever spelling drifted in', () => {
  setPlatformDisplayNames({ GitesDeFrance: 'Gîtes de France', Greengo: 'GreenGo' });
  expect(formatPlatformLabel('gites-de-france')).toBe('Gîtes de France');
  expect(formatPlatformLabel('greengo')).toBe('GreenGo');
  expect(formatPlatformLabel('abracadaroom')).toBe('Abracadaroom');
});
