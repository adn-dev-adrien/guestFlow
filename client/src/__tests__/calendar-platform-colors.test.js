import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';

import {
  PLATFORM_COLORS,
  DEFAULT_PLATFORM_COLOR,
} from '../constants/platforms';
import { getReservationColor } from '../utils/calendarVisuals';
import { buildMiniStripDayGradient } from '../components/MiniPlanningStrip';

// 2026-06-05 regression net. After PR #118 normalized every platform name to
// UpperCamelCase, the four calendar surfaces silently fell back to the default
// grey because they were doing direct `PLATFORM_COLORS[platform]` lookups
// (lowercase keys vs UpperCamelCase values from the DB). This file pins every
// path that maps a reservation's platform to a colour: the central
// `getReservationColor` util + the mini strip's `buildDayGradient` helper. (The
// SyncedPropertyMiniCalendars gradient was covered here too until that dead
// component was removed by the phase-1 DS cleanup, specs/ds-theme-maison.md.)
// The bottom of the file also asserts that no source module outside
// `constants/platforms.js` does a direct `PLATFORM_COLORS[…]` lookup (which
// would re-open the regression silently).

// ── Pure-function coverage ─────────────────────────────────────────────────

describe('getReservationColor (utils/calendarVisuals) — central calendar colour resolver', () => {
  test('resolves UpperCamelCase platform values (the regression) — never default grey', () => {
    for (const platform of ['Airbnb', 'Booking', 'Greengo', 'Abritel', 'Abracadaroom', 'Gitedefrance', 'Pitchup']) {
      const color = getReservationColor(platform);
      expect(color).not.toBe(DEFAULT_PLATFORM_COLOR);
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  test('resolves lowercase / legacy platform values too (backward compatibility)', () => {
    expect(getReservationColor('airbnb')).toBe(PLATFORM_COLORS.airbnb);
    expect(getReservationColor('booking')).toBe(PLATFORM_COLORS.booking);
    expect(getReservationColor('direct')).toBe(PLATFORM_COLORS.direct);
  });

  test('unknown platform → default grey (legitimate fallback)', () => {
    expect(getReservationColor('UnknownVendor')).toBe(DEFAULT_PLATFORM_COLOR);
  });
});

// ── MiniPlanningStrip — embedded in ReservationPage ────────────────────────

describe('buildMiniStripDayGradient (MiniPlanningStrip inside the reservation form)', () => {
  // The mini strip's gradient is *almost* identical to the synced calendar's but
  // also handles blocked-night gradients + a `selectedReservationColor` override
  // for the currently-edited reservation. These tests pin both the regression
  // (UpperCamelCase platforms → known colours) and the override path.

  test('Airbnb middle-of-stay day, not selected → uses the airbnb colour', () => {
    const out = buildMiniStripDayGradient({
      departureRes: null,
      arrivalRes: null,
      middleRes: { platform: 'Airbnb' },
      middleIsSelected: false,
      selectedReservationColor: '#000000',
    });
    expect(out.background).toBe(PLATFORM_COLORS.airbnb);
  });

  test('middle day, IS the current reservation → uses selectedReservationColor override', () => {
    const out = buildMiniStripDayGradient({
      departureRes: null,
      arrivalRes: null,
      middleRes: { platform: 'Airbnb' },
      middleIsSelected: true,
      selectedReservationColor: '#123abc',
    });
    expect(out.background).toBe('#123abc');
  });

  test('Booking departure (UpperCamelCase) keeps the booking colour in the gradient', () => {
    const out = buildMiniStripDayGradient({
      departureRes: { platform: 'Booking', checkOutTime: '10:00' },
      arrivalRes: null,
      middleRes: null,
      selectedReservationColor: '#000000',
    });
    expect(out.background).toContain(PLATFORM_COLORS.booking);
  });

  test('back-to-back day: Airbnb checkout + Booking check-in → gradient contains BOTH platform colours', () => {
    const out = buildMiniStripDayGradient({
      departureRes: { platform: 'Airbnb', checkOutTime: '10:00' },
      arrivalRes: { platform: 'Booking', checkInTime: '15:00' },
      middleRes: null,
      selectedReservationColor: '#000000',
    });
    expect(out.background).toContain(PLATFORM_COLORS.airbnb);
    expect(out.background).toContain(PLATFORM_COLORS.booking);
  });
});

// ── Filesystem invariant — every calendar consumer goes through ────────────
// ── getPlatformColor / getReservationColor, never a direct PLATFORM_COLORS[…] ──

describe('No direct PLATFORM_COLORS[…] lookup outside constants/platforms.js', () => {
  test('every source file routes the colour resolution through the helper', () => {
    // Glob the client/src tree, skip the constants module (legitimate owner +
    // any test fixture file. Catch the regression pattern at lint time: a
    // direct `PLATFORM_COLORS[whatever]` access in a runtime file would
    // silently break on UpperCamelCase platform values again.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const srcRoot = path.resolve(here, '..');

    function* walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip __tests__ folders + any node_modules that drifted in.
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          yield* walk(full);
        } else if (entry.isFile() && /\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) {
          yield full;
        }
      }
    }

    const offenders = [];
    // Match `PLATFORM_COLORS[anything]` followed by anything OTHER than a
    // single `=` (assignment). This excludes writes like the `customColors`
    // merge in App.js (`PLATFORM_COLORS[key] = color`) — that path is safe
    // because the key is normalised through `normalizePlatformKey` before
    // assignment. Any bracket READ (the regression shape `=== `, `||`, used
    // as an rvalue, etc.) is flagged.
    const RE_DIRECT_READ = /PLATFORM_COLORS\s*\[[^\]]+\](?!\s*=[^=])/;
    for (const file of walk(srcRoot)) {
      // The constants module IS allowed to read its own map.
      if (file.endsWith(path.join('constants', 'platforms.js'))) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (RE_DIRECT_READ.test(content)) {
        offenders.push(path.relative(srcRoot, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
