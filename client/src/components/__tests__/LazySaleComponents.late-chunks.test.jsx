// specs/plugins-phase-1-sdk.md rule 54 (reading of 2026-11-18, loop t22 A22-1) and specs/server-test-isolation.md rule 23 (readings
// of 2026-11-18, loops t22 A22-1 and t23 UI23-1) — every TEST, not only the first of its file, runs
// with the four SDK sale blocks' code cold and arriving late (`src/setupLateSaleChunks.js`, a setup file of vitest.config.js), so a test that acts before its dialog has the code fails
// every time. This file checks that the delay is in place, and that every dialog waiting for that code (`useSaleComponentsReady`,
// enumerated from the code) is rendered by at least one suite — each such suite therefore runs the real late path.
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..', '..');
function filesOf(dir, keep) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : filesOf(full, keep);
    return keep(full) ? [full] : [];
  });
}
const sources = filesOf(SRC, (f) => /\.jsx?$/.test(f) && !f.includes(`${path.sep}__tests__${path.sep}`));
const suites = filesOf(SRC, (f) => /\.test\.jsx?$/.test(f));
const CONSUMERS = sources
  .filter((f) => !f.endsWith(`${path.sep}LazySaleComponents.jsx`) && /\buseSaleComponentsReady\(/.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.basename(f).replace(/\.jsx?$/, ''))
  .sort();

// A test takes the module its dialogs import (no fresh registry): the code a previous test of this file loaded is forgotten by the
// setup's `beforeEach`, so each test below meets it cold and late — the first one and a later one alike, in either order (loop t23 UI23-1).
async function coldAndLate() {
  const Lazy = await import('../LazySaleComponents');
  expect(Lazy.saleComponentsLoaded()).toBe(false);
  const started = performance.now();
  await Lazy.preloadSaleComponents();
  expect(Lazy.saleComponentsLoaded()).toBe(true);
  return performance.now() - started;
}

test('the sale blocks\' code arrives late in every suite', async () => {
  const config = fs.readFileSync(path.resolve(SRC, '..', 'vitest.config.js'), 'utf8');
  expect(config).toMatch(/setupFiles:\s*\[[^\]]*'\.\/src\/setupLateSaleChunks\.js'/);
  expect(await coldAndLate()).toBeGreaterThanOrEqual(15);
});

test('a later test of the same file meets the code cold and late again', async () => {
  expect(await coldAndLate()).toBeGreaterThanOrEqual(15);
});

test('every dialog that waits for the sale code, read from the code, is rendered by a suite', () => {
  expect(CONSUMERS).toEqual(['ReservationSasDialog', 'ResourceArrivalDialog']);
  for (const name of CONSUMERS) {
    const rendering = suites.filter((f) => path.basename(f).startsWith(`${name}.`) || fs.readFileSync(f, 'utf8').includes(`<${name}`));
    expect(rendering.length, `${name} has no suite`).toBeGreaterThan(0);
  }
});
