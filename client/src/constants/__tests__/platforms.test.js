import { describe, test, expect } from 'vitest';

import {
  PLATFORMS,
  PLATFORM_COLORS,
  DEFAULT_PLATFORM_COLOR,
  normalizePlatformKey,
  getPlatformColor,
} from '../platforms';

// Regression coverage for the bug reported on 2026-06-05: after the
// platform-name normalization migration (PR #118), reservations carry
// `platform = 'Airbnb'` / `'Gitedefrance'` (UpperCamelCase) but the
// client's PLATFORM_COLORS map keys were lowercase ('airbnb',
// 'gitedefrance'). Direct lookups `PLATFORM_COLORS[platform]` returned
// undefined → calendar fell back to grey. This file pins the slug-based
// lookup so the regression can't reappear silently.

describe('normalizePlatformKey', () => {
  test('lowercases + strips non-alphanumerics', () => {
    expect(normalizePlatformKey('Airbnb')).toBe('airbnb');
    expect(normalizePlatformKey('AIRBNB')).toBe('airbnb');
    expect(normalizePlatformKey('Gitedefrance')).toBe('gitedefrance');
  });

  test('strips diacritics (NFD normalization)', () => {
    expect(normalizePlatformKey('Gîtes de France')).toBe('gitesdefrance');
    expect(normalizePlatformKey('Crème')).toBe('creme');
  });

  test('strips dashes / underscores / dots / spaces — matches the server slug shape', () => {
    expect(normalizePlatformKey('gites-de-france')).toBe('gitesdefrance');
    expect(normalizePlatformKey('gites_de_france')).toBe('gitesdefrance');
    expect(normalizePlatformKey('gites.de.france')).toBe('gitesdefrance');
    expect(normalizePlatformKey('  gites  de  france  ')).toBe('gitesdefrance');
  });

  test('preserves the canonical "direct" enum value', () => {
    expect(normalizePlatformKey('direct')).toBe('direct');
    expect(normalizePlatformKey('Direct')).toBe('direct');
    expect(normalizePlatformKey('DIRECT')).toBe('direct');
  });

  test('null / undefined / empty input → empty string', () => {
    expect(normalizePlatformKey(null)).toBe('');
    expect(normalizePlatformKey(undefined)).toBe('');
    expect(normalizePlatformKey('')).toBe('');
    expect(normalizePlatformKey('   ')).toBe('');
  });

  test('numeric input is coerced to string then slugged', () => {
    expect(normalizePlatformKey(42)).toBe('42');
  });
});

describe('getPlatformColor', () => {
  test('lowercase known key → matching colour', () => {
    expect(getPlatformColor('airbnb')).toBe(PLATFORM_COLORS.airbnb);
    expect(getPlatformColor('booking')).toBe(PLATFORM_COLORS.booking);
    expect(getPlatformColor('direct')).toBe(PLATFORM_COLORS.direct);
  });

  test('UpperCamelCase from a normalized reservation row → matching colour (the regression)', () => {
    // Post-PR #118 storage shape for every non-direct platform.
    expect(getPlatformColor('Airbnb')).toBe(PLATFORM_COLORS.airbnb);
    expect(getPlatformColor('Booking')).toBe(PLATFORM_COLORS.booking);
    expect(getPlatformColor('Gitedefrance')).toBe(PLATFORM_COLORS.gitedefrance);
    expect(getPlatformColor('Pitchup')).toBe(PLATFORM_COLORS.pitchup);
  });

  test('the "Gîtes de France" plural spelling resolves to the same colour as the singular slug', () => {
    // The user-typed accented form + the plural form both map to the same colour
    // — see PLATFORM_COLORS.gitesdefrance alias.
    expect(getPlatformColor('GitesDeFrance')).toBe(PLATFORM_COLORS.gitedefrance);
    expect(getPlatformColor('Gîtes de France')).toBe(PLATFORM_COLORS.gitedefrance);
  });

  test('unknown platform → DEFAULT_PLATFORM_COLOR (grey)', () => {
    expect(getPlatformColor('Lodgify')).toBe(DEFAULT_PLATFORM_COLOR);
    expect(getPlatformColor('UnknownPlatform')).toBe(DEFAULT_PLATFORM_COLOR);
  });

  test('null / empty platform → DEFAULT_PLATFORM_COLOR', () => {
    expect(getPlatformColor(null)).toBe(DEFAULT_PLATFORM_COLOR);
    expect(getPlatformColor('')).toBe(DEFAULT_PLATFORM_COLOR);
    expect(getPlatformColor(undefined)).toBe(DEFAULT_PLATFORM_COLOR);
  });
});

describe('PLATFORMS dropdown enum', () => {
  test('matches the canonical form the server stores after normalize-platform-names', () => {
    // 'direct' lowercase (canonical enum preserved by formatPlatformName);
    // every other entry is UpperCamelCase. A saved-then-reloaded reservation
    // form must find its value in this list or the <Select> shows blank.
    expect(PLATFORMS).toContain('direct');
    expect(PLATFORMS).toContain('Airbnb');
    expect(PLATFORMS).toContain('Booking');
    expect(PLATFORMS).toContain('Gitedefrance');
    // No accidental duplicate lowercase entries.
    expect(PLATFORMS.filter((p) => p === 'airbnb')).toHaveLength(0);
  });

  test('every entry has a defined colour via getPlatformColor', () => {
    for (const platform of PLATFORMS) {
      expect(getPlatformColor(platform)).not.toBe(DEFAULT_PLATFORM_COLOR);
    }
  });
});
