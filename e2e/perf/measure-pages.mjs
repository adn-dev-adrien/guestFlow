#!/usr/bin/env node
/**
 * Page-load measurement (specs/inte-performance.md rule 6). A tool, not a gate: the numbers depend on
 * the machine.
 *
 *   GUESTFLOW_PERF_PASSWORD=... node e2e/perf/measure-pages.mjs <base-url> [--cpu 4] [--runs 3] [--width 1400] [route ...]
 *
 * Logs in (GUESTFLOW_PERF_EMAIL, default claude-test@guestflow.local; GUESTFLOW_PERF_PASSWORD
 * required) then, for each route, loads it from scratch `--runs` times and prints, as JSON, the median
 * time until the content stops changing (no spinner, no DOM change for 1 s), plus the requests, the
 * script files, the API calls, the long tasks (> 50 ms) and the console warnings of the last run.
 * `--cpu 4` throttles the CPU four times, standing for a busy computer or a mid-range phone.
 * Run it against a shadow started with `scripts/start-shadow.mjs`: a Vite dev server is 3 to 6 times
 * slower than the build and measures nothing about production.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { chromium } = createRequire(path.join(ROOT, 'package.json'))('@playwright/test');

const DEFAULT_ROUTES = ['/', '/emails', '/settings/plateformes', '/settings/emails/textes', '/calendar'];
const QUIET_MS = 1000;
const MAX_WAIT_MS = 60000;

export function parseArgs(argv) {
  const options = { base: null, cpu: 1, runs: 3, width: 1400, routes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cpu') options.cpu = Number(argv[++i]);
    else if (arg === '--runs') options.runs = Number(argv[++i]);
    else if (arg === '--width') options.width = Number(argv[++i]);
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else if (!options.base) options.base = arg.replace(/\/$/, '');
    else options.routes.push(arg);
  }
  if (!options.base) throw new Error('Usage: measure-pages.mjs <base-url> [--cpu 4] [--runs 3] [--width 1400] [route ...]');
  if (!options.routes.length) options.routes = DEFAULT_ROUTES;
  return options;
}

export const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const password = process.env.GUESTFLOW_PERF_PASSWORD;
  if (!password) throw new Error('GUESTFLOW_PERF_PASSWORD is required.');
  const email = process.env.GUESTFLOW_PERF_EMAIL || 'claude-test@guestflow.local';

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: options.width, height: 900 } });
  const page = await context.newPage();
  let requests = [];
  let warnings = 0;
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') warnings += 1; });
  page.on('requestfinished', async (r) => {
    try {
      requests.push({ url: r.url(), type: r.resourceType() });
    } catch { /* the page moved on */ }
  });
  await page.addInitScript(() => {
    window.__lastMutation = performance.now();
    window.__longTasks = [];
    new MutationObserver(() => { window.__lastMutation = performance.now(); })
      .observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    try {
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__longTasks.push(e.duration); })
        .observe({ type: 'longtask', buffered: true });
    } catch { /* long tasks unsupported */ }
  });

  await page.goto(`${options.base}/login`);
  await page.waitForSelector('input[type=password]');
  const status = await page.evaluate(async ({ email: e, password: p }) => (await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: p }),
  })).status, { email, password });
  if (status !== 200) throw new Error(`Login refused (${status}).`);
  if (options.cpu > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpu });
  }

  async function settled() {
    const start = Date.now();
    while (Date.now() - start < MAX_WAIT_MS) {
      const s = await page.evaluate(() => ({
        now: performance.now(), mutation: window.__lastMutation, spinners: document.querySelectorAll('[role=progressbar]').length, text: document.body.innerText.length,
      }));
      if (s.spinners === 0 && s.text > 200 && s.now - s.mutation > QUIET_MS) return Math.round(s.mutation);
      await page.waitForTimeout(100);
    }
    return -1;
  }

  const pages = {};
  for (const route of options.routes) {
    const times = [];
    for (let run = 0; run < options.runs; run += 1) {
      await page.goto('about:blank');
      requests = [];
      warnings = 0;
      await page.goto(`${options.base}${route}`);
      times.push(await settled());
    }
    const longTasks = await page.evaluate(() => window.__longTasks.filter((d) => d > 50));
    const scripts = requests.filter((r) => r.type === 'script');
    pages[route] = {
      settledMs: median(times),
      runsMs: times,
      requests: requests.length,
      scripts: scripts.length,
      api: [...new Set(requests.filter((r) => r.url.includes('/api/')).map((r) => r.url.replace(/^.*\/api/, '')))],
      longTasks: longTasks.length,
      longTaskMs: Math.round(longTasks.reduce((a, b) => a + b, 0)),
      warnings,
    };
  }
  console.log(JSON.stringify({ base: options.base, cpu: options.cpu, width: options.width, pages }, null, 2));
  await browser.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
