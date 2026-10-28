#!/usr/bin/env node
/**
 * The JavaScript every first page pays for, against a budget (specs/inte-performance.md rule 4).
 *
 *   cd client && npm run build && cd .. && node scripts/check-bundle-budget.mjs [--dist client/dist]
 *
 * Reads the Vite manifest (`build.manifest: true`) and sums the gzip size of the entry, of every chunk
 * it imports statically, and of the chunks it imports dynamically at boot (`App` and the plugin
 * runtime, which `index.jsx` always loads) with their own static imports. Pages are dynamic imports of
 * `App`: they are not counted, which is the point of loading them on demand.
 *
 * Fails above BUDGET_GZIP and names the biggest chunks. The budget is the measurement after the lazy
 * routes plus 10 % of headroom: raise it deliberately, in the PR that adds the weight, never to make
 * a red build green.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Measured 2026-10-28 after the lazy routes: 284 851 bytes gzip (before them: 637 kB). + 10 %.
export const MEASURED_GZIP = 284851;
export const BUDGET_GZIP = Math.ceil(MEASURED_GZIP * 1.1);

/**
 * @param {Record<string, {file: string, imports?: string[], dynamicImports?: string[], isEntry?: boolean}>} manifest
 * @param {(file: string) => number} gzipSize
 * @returns {{total: number, chunks: Array<{file: string, bytes: number}>}} the initial chunks, biggest first
 */
export function initialWeight(manifest, gzipSize) {
  const entries = Object.keys(manifest).filter((key) => manifest[key].isEntry);
  if (!entries.length) throw new Error('No entry in the manifest.');
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key) || !manifest[key]) return;
    seen.add(key);
    (manifest[key].imports || []).forEach(visit);
  };
  for (const key of entries) {
    visit(key);
    (manifest[key].dynamicImports || []).forEach(visit);
  }
  const chunks = [...seen]
    .map((key) => manifest[key].file)
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({ file, bytes: gzipSize(file) }))
    .sort((a, b) => b.bytes - a.bytes);
  return { total: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0), chunks };
}

export function checkBudget(manifest, gzipSize, budget = BUDGET_GZIP) {
  const { total, chunks } = initialWeight(manifest, gzipSize);
  return { ok: total <= budget, total, budget, chunks };
}

function main() {
  const at = process.argv.indexOf('--dist');
  const dist = path.resolve(ROOT, at > -1 ? process.argv[at + 1] : 'client/dist');
  const manifestFile = path.join(dist, '.vite', 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    console.error(`No manifest at ${manifestFile}: run the client build first.`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const result = checkBudget(manifest, (file) => zlib.gzipSync(fs.readFileSync(path.join(dist, file))).length);
  const kB = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;
  console.log(`Initial JavaScript: ${kB(result.total)} gzip (budget ${kB(result.budget)}).`);
  if (!result.ok) {
    console.error(`Over the budget by ${kB(result.total - result.budget)}. Heaviest initial chunks:`);
    for (const chunk of result.chunks.slice(0, 8)) console.error(`  ${kB(chunk.bytes).padStart(9)}  ${chunk.file}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
