/**
 * The runtime trace of the environment (specs/server-test-isolation.md rule 13), the complement of rule 12's
 * grep guard: that one reads `src/` and misses the forms it has no pattern for; this one sees those too, but
 * only where the suite runs the code against the real `process.env` (not through a copy, not on an injected
 * `env`, not on a path no test runs).
 *
 * - `start()`, called by the `npm test` preload. In the runner's own process (`node --test`, no
 *   `NODE_TEST_CONTEXT`) it creates the trace directory, hands it to the test processes in
 *   `GUESTFLOW_TEST_ENV_TRACE_DIR`, and at exit prints `report()` and sets the exit code to 1 when it fails.
 *   In a test process given the directory it calls `install`. Anywhere else (a process outside the runner,
 *   a runner without isolation, as `isolationNone` reads it, a test process of a run that made no directory)
 *   it does nothing, and clears the variable.
 * - `install({ dir, srcRoot })` replaces `process.env` with a Proxy over it. A string key read through
 *   `get`, `has` or `getOwnPropertyDescriptor` that `appEnvNames.js` does not cover, and every `ownKeys`
 *   (the environment taken whole: a spread, `Object.keys`, a child spawned without `env`), is attributed to
 *   the first frame of the stack outside this file: kept when it is a file of `srcRoot` outside any `tests`
 *   or `node_modules` folder, dropped otherwise (a test, a package, `node -e`, Node's own code for a key
 *   read; a whole take walks past Node's frames). The names a whole take reads on its own line are part of
 *   it, not reads, and so are the names `READ_BY_DESIGN` grants a function. Writes, deletes and the other traps reach
 *   the real object untouched. At exit the process writes what it saw to `<dir>/<pid>-….json`, even nothing.
 * - `collect(dir)` / `report(dir)`: merge the processes' files; `report` is what the runner prints.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { APP_ENV_NAMES, RUNNER_ENV_NAMES } = require('./appEnvNames');

const DIR_VAR = 'GUESTFLOW_TEST_ENV_TRACE_DIR';
const SERVER_SRC = path.resolve(__dirname, '..', '..');
const LISTED = new Set([...APP_ENV_NAMES, ...RUNNER_ENV_NAMES]);

// The functions of `src/` that read names the lists cannot hold, by design, as rule 12 pins them in its guard.
const READ_BY_DESIGN = {
  // The proxy settings and CA bundle handed on to the npm child (`PASS_THROUGH_ENV`).
  'utils/updateStaging.js#installEnv': new Set(['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS']),
  // The names the process's own `.env.local` holds, read back so the real environment wins.
  'utils/localEnv.js#loadLocalEnv': null,
};

const readByDesign = (within, name) => within in READ_BY_DESIGN && (READ_BY_DESIGN[within] === null || READ_BY_DESIGN[within].has(name));

const isListed = (name) => LISTED.has(name) || (name.startsWith('GUESTFLOW_') && !name.startsWith('GUESTFLOW_TEST_'));

const asFrames = (_, frames) => frames;

// A key read Node makes on its own behalf (`FORCE_COLOR` for a `console.log`, undici's knobs for a `fetch`, a
// `require`) is no read of the app: the first frame with a file is Node's. A whole take keeps walking, so a
// child spawned without `env` is the app's take.
function siteOf(srcRoot, skip, { throughNode }) {
  const { prepareStackTrace, stackTraceLimit } = Error;
  Error.prepareStackTrace = asFrames;
  Error.stackTraceLimit = 40;
  const holder = {};
  Error.captureStackTrace(holder, skip);
  const frames = holder.stack;
  Error.prepareStackTrace = prepareStackTrace;
  Error.stackTraceLimit = stackTraceLimit;
  for (const frame of frames) {
    let file = frame.getFileName();
    if (!file || file === __filename) continue;
    if (file.startsWith('node:')) {
      if (throughNode) continue;
      return null;
    }
    if (file.startsWith('file://')) file = fileURLToPath(file);
    const rel = path.relative(srcRoot, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const parts = rel.split(path.sep);
    if (parts.includes('tests') || parts.includes('node_modules')) return null;
    return { site: `${parts.join('/')}:${frame.getLineNumber()}`, within: `${parts.join('/')}#${frame.getFunctionName()}` };
  }
  return null;
}

function install({ dir, srcRoot: root = SERVER_SRC }) {
  const srcRoot = fs.realpathSync(root);
  const reads = new Map();
  const whole = new Set();
  const target = process.env;

  function read(name) {
    if (typeof name !== 'string' || isListed(name) || name in Object.prototype) return;
    const at = siteOf(srcRoot, read, { throughNode: false });
    if (!at || readByDesign(at.within, name)) return;
    if (!reads.has(name)) reads.set(name, new Set());
    reads.get(name).add(at.site);
  }

  process.env = new Proxy(target, {
    get(t, key) { read(key); return Reflect.get(t, key); },
    has(t, key) { read(key); return Reflect.has(t, key); },
    getOwnPropertyDescriptor(t, key) { read(key); return Reflect.getOwnPropertyDescriptor(t, key); },
    ownKeys(t) {
      const at = siteOf(srcRoot, this.ownKeys, { throughNode: true });
      if (at) whole.add(at.site);
      return Reflect.ownKeys(t);
    },
    set(t, key, value) { return Reflect.set(t, key, value); },
  });

  process.on('exit', () => {
    const own = {};
    for (const [name, sites] of reads) {
      const kept = [...sites].filter((site) => !whole.has(site));
      if (kept.length) own[name] = kept;
    }
    const file = process.argv[1] ? path.relative(path.dirname(srcRoot), path.resolve(process.argv[1])) : 'a `node -e` child of a test';
    const out = path.join(dir, `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    try {
      fs.writeFileSync(out, JSON.stringify({ file, reads: own, whole: [...whole] }));
    } catch {
      // The run that made the directory is gone; nobody is left to read the trace.
    }
  });
}

const ISOLATION_FLAG = /^--(experimental-)?test-isolation(=(.*))?$/;

// `--test-isolation=none`, `--test-isolation none`, and both under their `--experimental-` name; the last one
// given wins, as it does for Node.
function isolationNone(execArgv) {
  let mode;
  execArgv.forEach((arg, i) => {
    const match = ISOLATION_FLAG.exec(arg);
    if (match) mode = match[2] === undefined ? execArgv[i + 1] : match[3];
  });
  return mode === 'none';
}

function start() {
  if (process.env.NODE_TEST_CONTEXT) {
    if (process.env[DIR_VAR]) install({ dir: process.env[DIR_VAR] });
    return;
  }
  const runner = process.execArgv.includes('--test') && !isolationNone(process.execArgv);
  if (!runner) {
    delete process.env[DIR_VAR];
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-env-trace-'));
  process.env[DIR_VAR] = dir;
  process.on('exit', () => {
    const { ok, text } = report(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    process.stderr.write(text);
    if (!ok) process.exitCode = 1;
  });
}

function collect(dir) {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.json'));
  const byName = new Map();
  const whole = new Set();
  for (const name of files) {
    const trace = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    for (const [key, sites] of Object.entries(trace.reads)) {
      if (isListed(key)) continue;
      if (!byName.has(key)) byName.set(key, { sites: new Set(), files: new Set() });
      for (const site of sites) byName.get(key).sites.add(site);
      byName.get(key).files.add(trace.file);
    }
    for (const site of trace.whole) whole.add(site);
  }
  const unlisted = [...byName].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { sites, files: seenIn }]) => ({ name, sites: [...sites].sort(), files: [...seenIn].sort() }));
  return { processes: files.length, unlisted, whole: [...whole].sort() };
}

function report(dir) {
  let traced;
  try {
    traced = collect(dir);
  } catch (error) {
    return { ok: false, text: `✖ environment trace: cannot read ${dir} (${error.code || error.message}).\n` };
  }
  if (!traced.processes) return { ok: false, text: `✖ environment trace: no test process wrote to ${dir}.\n` };
  const whole = `src/ took the environment whole at: ${traced.whole.join(', ') || 'nowhere'}.\n`;
  if (!traced.unlisted.length) {
    return { ok: true, text: `ℹ environment trace (test processes: ${traced.processes}): every name src/ read is in appEnvNames.js; ${whole}` };
  }
  const lines = traced.unlisted.map(({ name, sites, files }) => `  - ${name}, read at ${sites.join(', ')} (while running ${files.slice(0, 3).join(', ')}${files.length > 3 ? ', …' : ''})\n`);
  return {
    ok: false,
    text: `✖ environment trace: src/ read ${traced.unlisted.length} name(s) on neither list of src/tests/setup/appEnvNames.js:\n${lines.join('')}  ${whole}`,
  };
}

module.exports = { DIR_VAR, install, start, collect, report, isolationNone };
