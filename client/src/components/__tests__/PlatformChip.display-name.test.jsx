// specs/platform-settings-relay-and-review.md rule 12 — one label per platform: the chip renders the
// display name the server serves (« Gîtes de France »), never the stored key « GitesDeFrance », and
// re-renders when the names arrive after it first drew (audit 2026-10-27).
import React from 'react';
import { act, render, screen } from '@testing-library/react';

import PlatformChip from '../PlatformChip';
import { formatPlatformLabel, setPlatformDisplayNames } from '../../constants/platforms';

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
