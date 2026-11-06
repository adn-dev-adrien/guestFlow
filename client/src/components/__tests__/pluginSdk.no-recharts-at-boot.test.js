/**
 * specs/report-grammar.md §3 rule 20 — the plugin SDK sits in the initial bundle: nothing it imports
 * statically may reach Recharts, or every first page pays ~110 kB gzip for it (the CI bundle budget,
 * scripts/check-bundle-budget.mjs, measures the same thing on a real build).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const STATIC = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

function resolve(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  return ['', '.js', '.jsx', '/index.js', '/index.jsx'].map((x) => base + x).find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
}

function staticPackages(entry) {
  const seen = new Set();
  const packages = new Set();
  const visit = (file) => {
    if (!file || seen.has(file)) return;
    seen.add(file);
    const code = fs.readFileSync(file, 'utf8');
    for (const m of code.matchAll(STATIC)) {
      const spec = m[1] || m[2];
      if (spec.startsWith('.')) visit(resolve(file, spec));
      else packages.add(spec.split('/')[0]);
    }
  };
  visit(entry);
  return packages;
}

test('rule 20 — the SDK reaches no Recharts through its static imports', () => {
  const packages = staticPackages(path.join(SRC, 'plugins/sdk/index.js'));
  expect(packages.has('@mui')).toBe(true);
  expect(packages.has('recharts')).toBe(false);
  // The walker itself sees Recharts where it is: the chart module imports it.
  expect(staticPackages(path.join(SRC, 'components/TrendChart.jsx')).has('recharts')).toBe(true);
});

test('rule 20 — the charts it hands out still draw: same names, lazily loaded', async () => {
  const sdk = await import('../../plugins/sdk');
  const lazy = await import('../LazyReportCharts');
  expect(sdk.TrendChart).toBe(lazy.LazyTrendChart);
  expect(sdk.AlignedDailyCumulativeCharts).toBe(lazy.LazyAlignedDailyCumulativeCharts);
}, 30000);
