// specs/plugins-phase-1-sdk.md rule 54 (reading of 2026-11-18, loop t22 A22-1) and specs/server-test-isolation.md rule 23 —
// every suite runs with the four SDK sale blocks' code
// arriving late (`src/setupLateSaleChunks.js`, a setup file of vitest.config.js), so a test that acts before its dialog has the code fails
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

test('the sale blocks\' code arrives late in every suite', async () => {
  const config = fs.readFileSync(path.resolve(SRC, '..', 'vitest.config.js'), 'utf8');
  expect(config).toMatch(/setupFiles:\s*\[[^\]]*'\.\/src\/setupLateSaleChunks\.js'/);
  const started = performance.now();
  await import('../SalePaymentLink');
  expect(performance.now() - started).toBeGreaterThanOrEqual(15);
});

test('every dialog that waits for the sale code, read from the code, is rendered by a suite', () => {
  expect(CONSUMERS).toEqual(['ReservationSasDialog', 'ResourceArrivalDialog']);
  for (const name of CONSUMERS) {
    const rendering = suites.filter((f) => path.basename(f).startsWith(`${name}.`) || fs.readFileSync(f, 'utf8').includes(`<${name}`));
    expect(rendering.length, `${name} has no suite`).toBeGreaterThan(0);
  }
});
