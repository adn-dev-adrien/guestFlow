// Non-regression tests for the pure helpers backing PropertyDetail.js.
//
// These functions carry the page's only real logic (the rest is rendering + API orchestration,
// per the fat-backend / thin-frontend rule), and two of them — normalizeTimedOptionForSnapshot
// + buildTimedOptionsSnapshot — drive the timed-options "dirty" detection that powers the
// unsaved-changes navigation guard. Locking them down here guards against silent regressions.

import {
  previewWithArticle,
  getSortedSeasonRanges,
  normalizeTimedOptionForSnapshot,
  buildTimedOptionsSnapshot,
} from '../PropertyDetail';

// ── previewWithArticle: "votre séjour <article> <name>" preview (mirrors the server formatter) ──

describe('previewWithArticle', () => {
  test('empty / whitespace / nullish name → empty string', () => {
    expect(previewWithArticle('', 'au')).toBe('');
    expect(previewWithArticle('   ', 'au')).toBe('');
    expect(previewWithArticle(null, 'au')).toBe('');
    expect(previewWithArticle(undefined, 'au')).toBe('');
  });

  test('apostrophe article elides (no space)', () => {
    expect(previewWithArticle('Étable', "à l'")).toBe("à l'Étable");
  });

  test('non-apostrophe articles get a separating space', () => {
    expect(previewWithArticle('Moulin', 'au')).toBe('au Moulin');
    expect(previewWithArticle('Bergerie', 'à la')).toBe('à la Bergerie');
    expect(previewWithArticle('Écuries', 'aux')).toBe('aux Écuries');
  });

  test('falsy article defaults to « au »', () => {
    expect(previewWithArticle('Moulin')).toBe('au Moulin');
    expect(previewWithArticle('Moulin', '')).toBe('au Moulin');
  });

  test('trims surrounding whitespace from the name', () => {
    expect(previewWithArticle('  Moulin  ', 'au')).toBe('au Moulin');
  });
});

// ── getSortedSeasonRanges: prefer dateRanges (filtered + sorted), else the legacy single range ──

describe('getSortedSeasonRanges', () => {
  test('returns dateRanges sorted ascending by startDate', () => {
    const rule = {
      dateRanges: [
        { startDate: '2026-07-01', endDate: '2026-07-15' },
        { startDate: '2026-03-01', endDate: '2026-03-10' },
        { startDate: '2026-05-01', endDate: '2026-05-20' },
      ],
    };
    expect(getSortedSeasonRanges(rule).map((r) => r.startDate)).toEqual([
      '2026-03-01', '2026-05-01', '2026-07-01',
    ]);
  });

  test('filters out ranges missing a start or end date', () => {
    const rule = {
      dateRanges: [
        { startDate: '2026-07-01', endDate: '2026-07-15' },
        { startDate: '2026-08-01' },               // no endDate → dropped
        { endDate: '2026-09-30' },                 // no startDate → dropped
      ],
    };
    expect(getSortedSeasonRanges(rule)).toEqual([{ startDate: '2026-07-01', endDate: '2026-07-15' }]);
  });

  test('falls back to the legacy single range when there are no dateRanges', () => {
    const rule = { startDate: '2026-07-01', endDate: '2026-07-15' };
    expect(getSortedSeasonRanges(rule)).toEqual([{ startDate: '2026-07-01', endDate: '2026-07-15' }]);
  });

  test('non-empty dateRanges short-circuits the legacy fallback (even if all are invalid)', () => {
    // ranges.length > 0 → the dateRanges branch is taken and filtered to [], the legacy
    // startDate/endDate is NOT consulted. Locks the current (subtle) precedence.
    const rule = { dateRanges: [{ startDate: '2026-07-01' }], startDate: '2026-01-01', endDate: '2026-01-31' };
    expect(getSortedSeasonRanges(rule)).toEqual([]);
  });

  test('returns [] when nothing valid is present', () => {
    expect(getSortedSeasonRanges({})).toEqual([]);
    expect(getSortedSeasonRanges(null)).toEqual([]);
    expect(getSortedSeasonRanges(undefined)).toEqual([]);
    expect(getSortedSeasonRanges({ startDate: '2026-07-01' })).toEqual([]); // legacy half-range → dropped
  });
});

// ── normalizeTimedOptionForSnapshot: only the persisted-and-meaningful fields enter the snapshot ──

describe('normalizeTimedOptionForSnapshot', () => {
  test('nullish option → null', () => {
    expect(normalizeTimedOptionForSnapshot(null)).toBeNull();
    expect(normalizeTimedOptionForSnapshot(undefined)).toBeNull();
  });

  test('coerces id to a number, with 0 / missing → null', () => {
    expect(normalizeTimedOptionForSnapshot({ id: '5' }).id).toBe(5);
    expect(normalizeTimedOptionForSnapshot({ id: 0 }).id).toBeNull();
    expect(normalizeTimedOptionForSnapshot({ id: '0' }).id).toBeNull();
    expect(normalizeTimedOptionForSnapshot({}).id).toBeNull();
  });

  test('coerces autoEnabled to a boolean', () => {
    expect(normalizeTimedOptionForSnapshot({ autoEnabled: 1 }).autoEnabled).toBe(true);
    expect(normalizeTimedOptionForSnapshot({ autoEnabled: 0 }).autoEnabled).toBe(false);
    expect(normalizeTimedOptionForSnapshot({ autoEnabled: true }).autoEnabled).toBe(true);
    expect(normalizeTimedOptionForSnapshot({}).autoEnabled).toBe(false);
  });

  test('autoPricingMode defaults to « fixed », autoFullNightThreshold to null, price to a number', () => {
    const out = normalizeTimedOptionForSnapshot({});
    expect(out.autoPricingMode).toBe('fixed');
    expect(out.autoFullNightThreshold).toBeNull();
    expect(out.price).toBe(0);
    expect(normalizeTimedOptionForSnapshot({ price: '25' }).price).toBe(25);
    expect(normalizeTimedOptionForSnapshot({ autoFullNightThreshold: '10:00' }).autoFullNightThreshold).toBe('10:00');
  });

  test('ignores non-snapshot fields (title, description, propertyIds, priceType…)', () => {
    const out = normalizeTimedOptionForSnapshot({ id: 3, title: 'X', description: 'Y', priceType: 'per_stay', propertyIds: [1] });
    expect(Object.keys(out).sort()).toEqual(['autoEnabled', 'autoFullNightThreshold', 'autoPricingMode', 'id', 'price']);
  });
});

// ── buildTimedOptionsSnapshot: the equality signal behind `timedOptionsDirty` ──

describe('buildTimedOptionsSnapshot (dirty detection)', () => {
  const base = {
    early: { id: 1, autoEnabled: true, autoPricingMode: 'fixed', autoFullNightThreshold: '10:00', price: 20 },
    late: { id: 2, autoEnabled: false, autoPricingMode: 'full_night', autoFullNightThreshold: '17:00', price: 30 },
  };

  test('identical inputs → identical snapshots (not dirty)', () => {
    expect(buildTimedOptionsSnapshot(base)).toBe(buildTimedOptionsSnapshot({ early: { ...base.early }, late: { ...base.late } }));
  });

  test('changing only a NON-snapshot field (title) does NOT change the snapshot (stays clean)', () => {
    const withTitle = { early: { ...base.early, title: 'Renamed' }, late: { ...base.late, description: 'edited' } };
    expect(buildTimedOptionsSnapshot(withTitle)).toBe(buildTimedOptionsSnapshot(base));
  });

  test('changing a snapshot field flips the snapshot (becomes dirty)', () => {
    expect(buildTimedOptionsSnapshot({ ...base, early: { ...base.early, price: 21 } })).not.toBe(buildTimedOptionsSnapshot(base));
    expect(buildTimedOptionsSnapshot({ ...base, early: { ...base.early, autoEnabled: false } })).not.toBe(buildTimedOptionsSnapshot(base));
    expect(buildTimedOptionsSnapshot({ ...base, late: { ...base.late, autoFullNightThreshold: '18:00' } })).not.toBe(buildTimedOptionsSnapshot(base));
    expect(buildTimedOptionsSnapshot({ ...base, late: { ...base.late, autoPricingMode: 'fixed' } })).not.toBe(buildTimedOptionsSnapshot(base));
  });

  test('a missing slot (null) is part of the snapshot and differs from a present one', () => {
    expect(buildTimedOptionsSnapshot({ early: null, late: null })).toBe(buildTimedOptionsSnapshot({ early: undefined, late: undefined }));
    expect(buildTimedOptionsSnapshot({ early: null, late: base.late })).not.toBe(buildTimedOptionsSnapshot(base));
  });

  test('equivalent values via coercion are treated as clean (no false dirty)', () => {
    // id '1' vs 1, autoEnabled 1 vs true, price '20' vs 20 — all normalize equal.
    const coerced = { early: { id: '1', autoEnabled: 1, autoPricingMode: 'fixed', autoFullNightThreshold: '10:00', price: '20' }, late: { ...base.late } };
    expect(buildTimedOptionsSnapshot(coerced)).toBe(buildTimedOptionsSnapshot(base));
  });
});
