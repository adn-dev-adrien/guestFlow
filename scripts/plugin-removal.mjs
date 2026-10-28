#!/usr/bin/env node
/**
 * The plugin removal matrix (specs/plugin-removal-resilience.md rules 7, 13, 14, 15).
 *
 *   list                              the plugin ids of the tree, as JSON (the CI matrix is built from it)
 *   remove <id> [--root dir]          delete a plugin — and the plugins that require it — from the tree:
 *                                     both folders and its line in both module lists; prints the ids
 *   routes <id>                       the API paths the plugin registers, as JSON
 *   cell <id> [--in-place] [--sandbox dir] [--only a,b]
 *                                     one cell of the matrix: seed every plugin's data, remove the plugin,
 *                                     run the server suite, build the client and the packages, run the
 *                                     removal E2E. It works on a copy of the tree (`--sandbox`, default
 *                                     under TMPDIR); CI passes `--in-place` and consumes its checkout
 *   sweep [--shard i/n]               the toggle sweep: deactivate, reactivate, uninstall, purge and
 *                                     reinstall every plugin of the shard on one server
 *
 * Every step is run even after a failure, so a cell reports all it can. Ports: --port (default 4400),
 * the Vite-less production server of the removal E2E listens there. Exit code 1 when a step failed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const serverPlugins = (root) => path.join(root, 'server', 'src', 'plugins');
const clientPlugins = (root) => path.join(root, 'client', 'src', 'plugins');

/** → the sorted ids of the folders of `server/src/plugins` that hold a manifest. */
export function listPlugins(root) {
  return fs.readdirSync(serverPlugins(root), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(serverPlugins(root), d.name, 'manifest.json')))
    .map((d) => d.name)
    .sort();
}

/** → the ids of the client folders (a folder with an index module), without the SDK. */
export function listClientPlugins(root) {
  return fs.readdirSync(clientPlugins(root), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'sdk' && ['index.js', 'index.jsx'].some((f) => fs.existsSync(path.join(clientPlugins(root), d.name, f))))
    .map((d) => d.name)
    .sort();
}

/** Rule 14 — `id`, then every plugin whose manifest requires one already in the set, until stable. */
export function removalSet(root, id) {
  const ids = listPlugins(root);
  if (!ids.includes(id)) throw new Error(`unknown plugin "${id}"`);
  const requires = Object.fromEntries(ids.map((p) => [
    p, (JSON.parse(fs.readFileSync(path.join(serverPlugins(root), p, 'manifest.json'), 'utf8')).requires || []).map((r) => r.id),
  ]));
  const set = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    ids.filter((p) => !set.has(p) && requires[p].some((r) => set.has(r))).forEach((p) => { set.add(p); grew = true; });
  }
  return [...set].sort();
}

const camel = (id) => id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function dropLine(file, pattern) {
  const text = fs.readFileSync(file, 'utf8');
  const kept = text.split('\n').filter((line) => !pattern.test(line));
  if (kept.length === text.split('\n').length) throw new Error(`${path.relative(process.cwd(), file)} does not name the plugin`);
  fs.writeFileSync(file, kept.join('\n'));
}

function dropFromClientArray(file, name) {
  const text = fs.readFileSync(file, 'utf8');
  const next = text
    .replace(new RegExp(`\\s*\\b${name}\\b,`), (m) => (m.includes('\n') ? m.replace(/[^\n]*$/, '') : ''))
    .replace(new RegExp(`,\\s*\\b${name}\\b(?=\\s*\\])`), '');
  if (next === text) throw new Error(`${path.relative(process.cwd(), file)} does not list ${name}`);
  fs.writeFileSync(file, next);
}

/** Rules 7, 14 — removes the plugin and its dependents from the tree; returns their ids. */
export function removePlugin(root, id) {
  const removed = removalSet(root, id);
  removed.forEach((p) => {
    fs.rmSync(path.join(serverPlugins(root), p), { recursive: true, force: true });
    fs.rmSync(path.join(clientPlugins(root), p), { recursive: true, force: true });
    dropLine(path.join(serverPlugins(root), 'index.js'), new RegExp(`require\\('\\./${p}'\\)`));
    const clientIndex = path.join(clientPlugins(root), 'index.js');
    dropLine(clientIndex, new RegExp(`^import ${camel(p)} from '\\./${p}';`));
    dropFromClientArray(clientIndex, camel(p));
  });
  return removed;
}

function routesOf(root, id) {
  const code = `
    const Database = require('better-sqlite3');
    const registry = require('./src/plugins/sdk/registry');
    const mod = require('./src/plugins').find((m) => m.id === ${JSON.stringify(id)});
    require('./src/plugins/loader').registerAll({ db: new Database(':memory:'), modules: [mod], settingsModel: () => ({}), isInstalled: () => false });
    const r = registry.get(${JSON.stringify(id)});
    console.log(JSON.stringify({
      mounts: r.mounts.map((m) => m.path),
      routes: r.routes.map((x) => x.path),
      webhooks: r.webhooks.map((w) => w.path),
    }));`;
  const out = execFileSync(process.execPath, ['-e', code], { cwd: path.join(root, 'server'), encoding: 'utf8', env: { ...process.env, DB_PATH: ':memory:' } });
  return JSON.parse(out.trim().split('\n').pop());
}

// ---------------------------------------------------------------------------------------- the cell

const COPY_SKIP = new Set(['node_modules', '.git', 'dist', 'plugins-dist', '.auth', 'playwright-report', 'playwright-report-removal', 'test-results']);

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => !COPY_SKIP.has(path.basename(src)) || src === from,
  });
  ['', 'server', 'client'].forEach((dir) => {
    const target = path.join(to, dir, 'node_modules');
    if (!fs.existsSync(target)) fs.symlinkSync(path.join(from, dir, 'node_modules'), target);
  });
  const gitFile = path.join(from, '.git');
  if (fs.existsSync(gitFile) && fs.statSync(gitFile).isFile()) fs.copyFileSync(gitFile, path.join(to, '.git'));
}

function runStep(name, command, cmdArgs, { cwd, env = {}, logDir }) {
  const started = Date.now();
  const log = path.join(logDir, `${name}.log`);
  const out = fs.openSync(log, 'w');
  const res = spawnSync(command, cmdArgs, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', out, out] });
  fs.closeSync(out);
  const seconds = Math.round((Date.now() - started) / 1000);
  const tail = fs.readFileSync(log, 'utf8').split('\n').filter((l) => /^# (tests|pass|fail|skipped)|passed|failed|skipped/.test(l)).slice(-5).join(' | ');
  return { name, ok: res.status === 0, seconds, log, summary: tail };
}

function cell(id) {
  const source = path.resolve(HERE, '..');
  const inPlace = args.includes('--in-place');
  if (inPlace && process.env.CI !== 'true') throw new Error('--in-place deletes folders of this checkout: it only runs in CI (CI=true)');
  const tmp = process.env.TMPDIR || os.tmpdir();
  // A cell deletes folders: on a developer's machine it works on a copy, in CI (`--in-place`) on the checkout.
  const sandbox = inPlace ? null : path.resolve(flag('--sandbox', path.join(tmp, `gf-removal-sandbox-${id}`)));
  const root = sandbox || source;
  const port = Number(flag('--port', '4400'));
  if (sandbox) {
    fs.rmSync(root, { recursive: true, force: true });
    copyTree(source, root);
  }
  const work = fs.mkdtempSync(path.join(tmp, `gf-removal-${id}-`));
  const logDir = path.join(work, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const dbPath = path.join(work, 'removal.db');
  const results = [];
  const only = flag('--only') ? flag('--only').split(',') : null;
  const step = (name, command, cmdArgs, opts = {}) => {
    if (only && !only.includes(name)) return { ok: true };
    const r = runStep(name, command, cmdArgs, { cwd: root, logDir, ...opts });
    results.push(r);
    console.log(`${r.ok ? 'pass' : 'FAIL'}  ${id}  ${name}  ${r.seconds}s  ${r.summary}`);
    return r;
  };
  const baseEnv = { TMPDIR: work, DB_PATH: dbPath, GUESTFLOW_SMTP_DETECT: 'off', REMOVAL_WORK: work };
  step('seed', process.execPath, ['server/scripts/seed-e2e.js'], { env: { ...baseEnv, E2E_ADMIN_EMAIL: 'e2e@guestflow.test', E2E_ADMIN_PASSWORD: 'e2e-secret-1234' } });
  step('seed-data', process.execPath, ['server/scripts/seed-plugin-data.js'], { env: { ...baseEnv, REMOVAL_SEED_OUT: path.join(work, 'seed.json') } });
  step('snapshot', process.execPath, ['e2e/removal/snapshot.js'], { env: { ...baseEnv, SNAPSHOT_PORT: String(port + 2) } });
  const removed = removalSet(root, id);
  fs.writeFileSync(path.join(work, 'routes.json'), JSON.stringify(Object.fromEntries(removed.map((p) => [p, routesOf(root, p)]))));
  removePlugin(root, id);
  console.log(`removed: ${removed.join(', ')}`);
  step('server-suite', 'npm', ['--prefix', 'server', 'test'], { env: { ...baseEnv, DB_PATH: path.join(work, 'suite.db') } });
  step('client-build', 'npx', ['vite', 'build'], { cwd: path.join(root, 'client') });
  step('packages', process.execPath, ['scripts/build-plugin-packages.mjs']);
  step('e2e', 'npx', ['playwright', 'test', '-c', 'playwright.removal.config.js', 'removal.spec.js'], {
    env: { ...baseEnv, CI: 'true', E2E_REMOVAL_PORT: String(port), REMOVED_PLUGINS: removed.join(',') },
  });
  fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ plugin: id, removed, steps: results }, null, 2));
  console.log(`logs: ${logDir}`);
  return results.some((r) => !r.ok) ? 1 : 0;
}

function sweep() {
  const root = path.resolve(HERE, '..');
  const port = flag('--port', '4410');
  const shard = flag('--shard', '1/1');
  const work = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'gf-removal-sweep-'));
  const logDir = path.join(work, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const baseEnv = { TMPDIR: work, DB_PATH: path.join(work, 'removal.db'), GUESTFLOW_SMTP_DETECT: 'off' };
  fs.writeFileSync(path.join(work, 'routes.json'), JSON.stringify(Object.fromEntries(listPlugins(root).map((p) => [p, routesOf(root, p)]))));
  const steps = [
    runStep('seed', process.execPath, ['server/scripts/seed-e2e.js'], { cwd: root, logDir, env: { ...baseEnv, E2E_ADMIN_EMAIL: 'e2e@guestflow.test', E2E_ADMIN_PASSWORD: 'e2e-secret-1234' } }),
    runStep('seed-data', process.execPath, ['server/scripts/seed-plugin-data.js'], { cwd: root, logDir, env: { ...baseEnv, REMOVAL_SEED_OUT: path.join(work, 'seed.json') } }),
    runStep('client-build', 'npx', ['vite', 'build'], { cwd: path.join(root, 'client'), logDir }),
    runStep('packages', process.execPath, ['scripts/build-plugin-packages.mjs'], { cwd: root, logDir }),
    runStep('e2e', 'npx', ['playwright', 'test', '-c', 'playwright.removal.config.js', 'toggle-sweep.spec.js'], {
      cwd: root, logDir, env: { ...baseEnv, CI: 'true', E2E_REMOVAL_PORT: port, REMOVAL_WORK: work, SWEEP_SHARD: shard },
    }),
  ];
  steps.forEach((r) => console.log(`${r.ok ? 'pass' : 'FAIL'}  sweep ${shard}  ${r.name}  ${r.seconds}s  ${r.summary}`));
  console.log(`logs: ${logDir}`);
  return steps.some((r) => !r.ok) ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command] = positional;
  const root = path.resolve(flag('--root', path.resolve(HERE, '..')));
  try {
    if (command === 'list') {
      console.log(JSON.stringify(listPlugins(root)));
    } else if (command === 'remove') {
      console.log(JSON.stringify(removePlugin(root, positional[1])));
    } else if (command === 'routes') {
      console.log(JSON.stringify(routesOf(root, positional[1])));
    } else if (command === 'cell') {
      process.exit(cell(positional[1]));
    } else if (command === 'sweep') {
      process.exit(sweep());
    } else {
      console.error('usage: plugin-removal.mjs list | remove <id> | routes <id> | cell <id> | sweep');
      process.exit(2);
    }
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
