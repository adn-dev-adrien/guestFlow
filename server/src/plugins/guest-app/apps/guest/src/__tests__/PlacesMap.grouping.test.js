// specs/guest-app/guest-app-local-amenities.md rules 3, 10 — markers closer than 28 px group, at the maximum zoom they fan out; every
// category has a glyph the markers can draw (Lucide's drawing data) and a colour that holds against the white glyph.
import { describe, expect, it } from 'vitest';
import { clusterPoints, fanOut, GROUP_PX } from '../utils/clusterPoints';
import { glyphSvg } from '../utils/glyphSvg';
import { PLACE_STYLE } from '../constants/placeCategories';

describe('clusterPoints (rule 3)', () => {
  it('groups the markers closer than 28 px and leaves the others alone', () => {
    expect(GROUP_PX).toBe(28);
    const groups = clusterPoints([
      { id: 1, x: 100, y: 100 }, { id: 2, x: 120, y: 110 }, { id: 3, x: 300, y: 100 }, { id: 4, x: 100 + 28, y: 100 },
    ]);
    expect(groups.map((g) => g.ids)).toEqual([[1, 2], [3], [4]]);
    expect(groups[0]).toMatchObject({ x: 110, y: 105 });
  });

  it('shops on the exact same spot form one group', () => {
    expect(clusterPoints([{ id: 1, x: 5, y: 5 }, { id: 2, x: 5, y: 5 }, { id: 3, x: 5, y: 5 }]).map((g) => g.ids)).toEqual([[1, 2, 3]]);
  });

  it('fanning out puts each member of a group on its own spot, around the group\'s centre', () => {
    const [group] = clusterPoints([{ id: 1, x: 50, y: 50 }, { id: 2, x: 50, y: 50 }, { id: 3, x: 50, y: 50 }]);
    const spots = fanOut(group);
    expect(spots.map((s) => s.id)).toEqual([1, 2, 3]);
    const pairs = spots.flatMap((a, i) => spots.slice(i + 1).map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
    expect(Math.min(...pairs)).toBeGreaterThan(28);
    const centre = { x: spots.reduce((s, p) => s + p.x, 0) / 3, y: spots.reduce((s, p) => s + p.y, 0) / 3 };
    expect(centre.x).toBeCloseTo(50, 5);
    expect(centre.y).toBeCloseTo(50, 5);
    expect(fanOut({ ids: [9], x: 7, y: 8 })).toEqual([{ id: 9, x: 7, y: 8 }]);
  });
});

describe('the category palette (rule 10)', () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

  it('has the nine categories, each with its own colour, a white glyph at 3:1 or more, and drawing data for the marker', () => {
    expect(Object.keys(PLACE_STYLE)).toEqual(['dechets', 'boulangerie', 'pharmacie', 'boucherie', 'epicerie', 'tabac', 'poste', 'distributeur', 'carburant']);
    expect(new Set(Object.values(PLACE_STYLE).map((s) => s.color)).size).toBe(9);
    Object.entries(PLACE_STYLE).forEach(([key, { color, data }]) => {
      expect(contrast(color, '#FFFFFF'), key).toBeGreaterThanOrEqual(3);
      expect(contrast(color, '#F2EFE9'), `${key} on the map ground`).toBeGreaterThanOrEqual(3);
      const svg = glyphSvg(data, 18);
      expect(svg, key).toMatch(/^<svg [^>]*viewBox="0 0 24 24"/);
      expect(svg, key).toMatch(/<(path|circle|rect|line|polyline)\b/);
    });
  });
});
