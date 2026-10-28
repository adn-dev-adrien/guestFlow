#!/usr/bin/env node
/**
 * Starts a shadow: a throwaway copy of a GuestFlow database running THIS checkout, the way production
 * runs it (specs/inte-performance.md rule 1).
 *
 *   node scripts/start-shadow.mjs --db <file> [--port 4104] [--dir <folder>] [--env <.env.local>] [--dev]
 *
 * Default: the client is built (`vite build`) and the plugin packages too, then ONE server process
 * serves them on `--port` with GUESTFLOW_PLUGINS=packages. It never sets NODE_ENV=production (the mail
 * outbox is off there); like e2e/prod/serve.js it uses NODE_ENV=test. Mails go to `<dir>/outbox`,
 * Qonto and Neat point at a dead address, no DNS lookup of a sending domain.
 *
 * `--dev` keeps the Vite dev server (hot reload, plugins from sources, client on `--client-port`,
 * default `--port` - 1000). A dev server is 3 to 6 times slower than a build: the shadow is then not
 * representative of production speed.
 *
 * `shadowEnv`, `parseArgs` and `assertPortFree` are exported pure for the unit suite.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEAD_BASE = 'http://127.0.0.1:9';

export function parseArgs(argv) {
  const options = { db: null, port: 4104, dir: null, envFile: null, dev: false, clientPort: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === '--db') options.db = path.resolve(value());
    else if (arg === '--port') options.port = Number(value());
    else if (arg === '--client-port') options.clientPort = Number(value());
    else if (arg === '--dir') options.dir = path.resolve(value());
    else if (arg === '--env') options.envFile = path.resolve(value());
    else if (arg === '--dev') options.dev = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!options.db) throw new Error('--db <file> is required');
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be a port number');
  options.dir = options.dir || path.join(os.tmpdir(), `guestflow-shadow-${options.port}`);
  options.envFile = options.envFile || path.join(path.dirname(options.db), '.env.local');
  options.clientPort = options.clientPort || options.port - 1000;
  return options;
}

/** The environment the shadow's server runs with, on top of the caller's own. */
export function shadowEnv(options) {
  const dir = options.dir;
  const publicPort = options.dev ? options.clientPort : options.port;
  return {
    TZ: 'Europe/Paris',
    PORT: String(options.port),
    DB_PATH: path.join(dir, 'guestflow.db'),
    GUESTFLOW_UPLOADS_DIR: path.join(dir, 'uploads'),
    GUESTFLOW_LOCAL_ENV: path.join(dir, '.env.local'),
    GUESTFLOW_MAIL_OUTBOX: path.join(dir, 'outbox'),
    GUESTFLOW_SMTP_DETECT: 'off',
    GUESTFLOW_PUBLIC_URL: `http://localhost:${publicPort}`,
    QONTO_API_BASE: DEAD_BASE,
    QONTO_OAUTH_BASE: DEAD_BASE,
    NEAT_API_BASE: DEAD_BASE,
    ...(options.dev
      ? { NODE_ENV: 'development', GUESTFLOW_DEV: '1', GUESTFLOW_PLUGINS: 'sources', API_RATELIMIT_MAX: '100000' }
      : {
        NODE_ENV: 'test',
        GUESTFLOW_PLUGINS: 'packages',
        GUESTFLOW_PLUGINS_DIST: path.join(dir, 'plugins-dist'),
        GUESTFLOW_CLIENT_DIR: path.join(dir, 'client-dist'),
      }),
  };
}

/** Rejects when something already listens on the port, before anything is copied. */
export function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is already in use.`)));
    probe.listen(port, () => probe.close(() => resolve()));
  });
}

async function copyDatabase(source, target) {
  const Database = createRequire(path.join(ROOT, 'server', 'package.json'))('better-sqlite3');
  const db = new Database(source, { readonly: true });
  try {
    await db.backup(target);
  } finally {
    db.close();
  }
}

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
  return false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.db)) throw new Error(`Database not found: ${options.db}`);
  await assertPortFree(options.port);
  if (options.dev) await assertPortFree(options.clientPort);

  const pidsFile = path.join(options.dir, 'pids');
  if (fs.existsSync(pidsFile)) {
    for (const pid of fs.readFileSync(pidsFile, 'utf8').split('\n').filter(Boolean)) {
      try { process.kill(Number(pid)); } catch { /* already gone */ }
    }
  }
  fs.rmSync(options.dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(options.dir, 'outbox'), { recursive: true });
  await copyDatabase(options.db, path.join(options.dir, 'guestflow.db'));
  if (fs.existsSync(options.envFile)) fs.copyFileSync(options.envFile, path.join(options.dir, '.env.local'));
  const uploads = path.join(path.dirname(options.db), 'uploads');
  if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(options.dir, 'uploads'), { recursive: true });

  const env = { ...process.env, ...shadowEnv(options) };
  if (!options.dev) {
    console.log('Building the client and the plugin packages...');
    execFileSync('npx', ['vite', 'build', '--outDir', env.GUESTFLOW_CLIENT_DIR, '--emptyOutDir'], { cwd: path.join(ROOT, 'client'), stdio: 'inherit' });
    execFileSync(process.execPath, ['scripts/build-plugin-packages.mjs', '--out', env.GUESTFLOW_PLUGINS_DIST], { cwd: ROOT, stdio: 'inherit' });
  }

  const pids = [];
  const log = (name) => fs.openSync(path.join(options.dir, name), 'a');
  const server = spawn(process.execPath, ['src/index.js'], { cwd: path.join(ROOT, 'server'), env, detached: true, stdio: ['ignore', log('server.log'), log('server.log')] });
  server.unref();
  pids.push(server.pid);

  if (options.dev) {
    const config = path.join(options.dir, 'vite.config.mjs');
    fs.writeFileSync(config, `import base from ${JSON.stringify(path.join(ROOT, 'client', 'vite.config.js'))};\nexport default { ...base, cacheDir: ${JSON.stringify(path.join(options.dir, 'vite-cache'))} };\n`);
    const vite = spawn('npx', ['vite', '--config', config, '--port', String(options.clientPort), '--strictPort'], {
      cwd: path.join(ROOT, 'client'), detached: true, stdio: ['ignore', log('vite.log'), log('vite.log')],
      env: { ...env, BROWSER: 'none', GUESTFLOW_API_PORT: String(options.port) },
    });
    vite.unref();
    pids.push(vite.pid);
  }
  fs.writeFileSync(pidsFile, `${pids.join('\n')}\n`);

  const url = `http://localhost:${options.dev ? options.clientPort : options.port}`;
  if (!(await waitFor(`http://localhost:${options.port}/api/version`, 90000)) || !(await waitFor(url, 90000))) {
    throw new Error(`The shadow did not start: see ${path.join(options.dir, 'server.log')}`);
  }
  console.log(`Shadow ready: ${url}`);
  if (options.dev) console.log('Dev server: NOT representative of production speed (3 to 6 times slower). Drop --dev for a faithful shadow.');
  console.log(`Mails: ${env.GUESTFLOW_MAIL_OUTBOX}`);
  console.log(`Stop:  kill $(cat ${pidsFile})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
