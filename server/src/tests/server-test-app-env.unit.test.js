// specs/server-test-isolation.md rule 12 (reading of 2026-11-01, audit R13 L-1) — the `npm test` preload
// also drops every non-prefixed variable the app reads (`PUBLIC_SITE_ORIGIN`, the rate-limit knobs, QONTO_*,
// …), keeping only what the runner needs. The list lives in `setup/appEnvNames.js`; the guard below derives
// the app's reads from `src/` so a new `process.env.X` outside that list fails here, and (reading of the
// review of #920) so does any access it cannot read a name off; since audit R14 L-1 (reading of 2026-11-02),
// that includes an `env` taken whole (destructured, `in`, spread, aliased, handed to a call that does not name
// its parameter `env`) and `require('process')`; since the review of #924, an `env` returned whole and a call
// argument judged by the callee the call reaches, and a plugin's names keyed by its id (`PLUGIN_ENV_NAMES`) so
// that removing the plugin leaves this file green; since audit R15 L-1, an `env` as a ternary branch, `process`
// handed whole to a call, and a callee resolved to the innermost declaration in sight. The guard is a heuristic:
// it catches the forms of `PROBES`, and the spec lists what it knowingly lets through.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { listPlugins, missingPlugins } = require('../plugins/sdk/testing');

const PRELOAD = path.join(__dirname, 'setup', 'isolateDefaultDb.js');
const NAMES = path.join(__dirname, 'setup', 'appEnvNames.js');
const SERVER_ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(SERVER_ROOT, 'src');

// What the R13 audit exported, plus a sample of the other app variables it did not try one by one.
const SHELL = {
  PUBLIC_SITE_ORIGIN: 'https://example.test',
  PUBLIC_API_RATELIMIT_MAX: '5',
  BOOKING_REQUEST_RATELIMIT_MAX: '5',
  PAYMENT_START_RATELIMIT_MAX: '5',
  TRUST_PROXY_HOPS: '3',
  PUBLIC_API_KEY: 'shell-key',
  QONTO_ENV: 'production',
  QONTO_API_BASE: 'https://qonto.example.test',
  GATE_API_KEY: 'shell-gate',
  VAPID_PUBLIC_KEY: 'shell-vapid',
  TLS_CERT_PATH: '/nowhere/cert.pem',
  PAYMENT_POLL_TICK_MINUTES: '1',
  GITHUB_SHA: 'deadbeef',
  PORT: '1',
  GUESTFLOW_TEST_EXIT_GRACE_MS: '300',
  TZ: 'Pacific/Kiritimati',
};

function inChild(extra, code) {
  const env = { ...process.env, ...SHELL, ...extra };
  for (const k of ['DB_PATH', 'PERSISTENT_DB', 'GUESTFLOW_LOCAL_ENV', 'GUESTFLOW_UPLOADS_DIR']) delete env[k];
  assert.ok(env.NODE_TEST_CONTEXT, 'run under node --test');
  const r = spawnSync(process.execPath, ['--require', PRELOAD, '-e', code], { cwd: SERVER_ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const pickOf = (names) => `JSON.stringify(Object.fromEntries(${JSON.stringify(names)}.map((k) => [k, process.env[k] ?? null])))`;

test('rule 12 (2026-11-01): the preload drops the app variables the shell exports, the runner\'s own kept', () => {
  const seen = inChild({ NODE_ENV: 'test' }, `console.log(${pickOf([...Object.keys(SHELL), 'NODE_ENV', 'PATH'])})`);
  for (const name of Object.keys(SHELL)) {
    if (['GUESTFLOW_TEST_EXIT_GRACE_MS', 'TZ'].includes(name)) continue;
    assert.equal(seen[name], null, `${name} still set under the preload`);
  }
  assert.equal(seen.GUESTFLOW_TEST_EXIT_GRACE_MS, '300');
  assert.equal(seen.TZ, 'Pacific/Kiritimati', 'a clock sweep sets TZ on purpose');
  assert.equal(seen.NODE_ENV, 'test');
  assert.equal(seen.PATH, process.env.PATH);
});

test('rule 12 (2026-11-01): a NODE_ENV other than test is dropped, so a shell in production or development runs the suite as CI does', () => {
  for (const value of ['production', 'development']) {
    assert.deepEqual(inChild({ NODE_ENV: value }, `console.log(${pickOf(['NODE_ENV'])})`), { NODE_ENV: null }, value);
  }
});

test('rule 12 (2026-11-01): under the preload the readers of the audit no longer follow the shell', () => {
  const out = inChild({}, `
    const { resolveQontoConfig } = require('./src/utils/qonto/qontoConfig');
    const before = resolveQontoConfig({ settings: {} });
    process.env.PUBLIC_SITE_ORIGIN = 'https://inline.example';
    const inline = resolveQontoConfig({ settings: {} });
    console.log(JSON.stringify({ before: before.publicSiteOrigin, env: before.environment, inline: inline.publicSiteOrigin }));
  `);
  assert.deepEqual(out, { before: '', env: 'sandbox', inline: 'https://inline.example' }, 'a test that needs the variable sets it inline');
});

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'tests' && entry.name !== 'node_modules') sourceFiles(full, out);
    } else if (/\.(c|m)?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

// An `env` identifier, bare or as a property (`process.env`, `opts.env`, and since the review of #924 `f().env`),
// never the `env.local` of a file name.
const ENV = String.raw`(?:(?<![\w$.'"\`/])|(?<=[\w$)\]]\.))env`;
const KEY = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
// An `env` used as a value, neither `process.env` nor read by name or index.
const ENV_VALUE = String.raw`(?:(?!process\b)[\w$]+\s*(?:\?\.|\.)\s*)?env\b(?!\s*(?:\?\.|\.|\[))`;
// `process` as `require('process')` / `require('node:process')` gives it.
const REQUIRE_PROCESS = /\brequire\s*\(\s*(['"`])(?:node:)?process\1\s*\)/g;

const READS = [
  new RegExp(`${ENV}\\??\\.(${KEY})\\b`, 'g'),
  new RegExp(`${ENV}\\s*(?:\\?\\.)?\\s*\\[\\s*['"](${KEY})['"]\\s*\\]`, 'g'),
  new RegExp(`\\b(?:getOrCreateSecret|getOrCreate|rotateSecret|rotate)\\(\\s*['"\`](${KEY})['"\`]`, 'g'),
  /\bconst [A-Z_]*(?:KEY|SECRET)_NAME\s*=\s*['"`]([A-Z][A-Z0-9_]*)['"`]/g,
];
// Every way of reaching a variable whose name the scan cannot read off the source. The forms of audit R14 L-1
// and after match on the `shape` (strings blanked, review of #924 N-3): `'not set in env'` is no access.
const INDIRECT = [
  { re: new RegExp(`${ENV}\\s*(?:\\?\\.)?\\s*\\[(?!\\s*['"]${KEY}['"]\\s*\\])`, 'g') },
  { re: /\bprocess\s*(?:\?\.\s*)?\[|=\s*(?:globalThis\s*\.\s*)?process\s*(?=[;,)}\n]|$)/g },
  { re: new RegExp(`\\bReflect\\s*\\.\\s*\\w+\\(\\s*(?:[\\w$]+\\s*\\.\\s*)?env\\b`, 'g') },
  { re: /(?<![\w$.])env\s*:\s*[A-Za-z_$][\w$]*\s*(?:=(?!=)|[,}])/g },
  // Audit R14 L-1: an `env` (bare or `opts.env`, `process.env` being matched below) taken whole, so the names
  // it reaches are never written next to it: destructured, `in`, spread, aliased (`e = env`, and since the
  // review of #924 `e = env || {}` and `e = env ?? {}`), or handed to a call (`read(env)`, `Object.keys(env)`).
  { on: 'shape', re: new RegExp(`\\}\\s*=\\s*${ENV_VALUE}`, 'g') },
  { on: 'shape', re: new RegExp(`\\bin\\s+${ENV_VALUE}`, 'g') },
  { on: 'shape', re: new RegExp(`\\.\\.\\.\\s*${ENV_VALUE}`, 'g') },
  { on: 'shape', re: new RegExp(`(?<!(?<![\\w$.])env\\s*)(?<![=!<>])=\\s*${ENV_VALUE}\\s*(?=[;,)}\\n]|\\|\\||\\?\\?|$)`, 'g') },
  { on: 'shape', re: new RegExp(`[(,]\\s*${ENV_VALUE}\\s*(?=[),])`, 'g'), keep: (src, index, ctx) => !handedToEnvParameter(src, index + 1, ctx) },
  // Review of #924 (L-3): an `env` that leaves its function whole, which the caller then reads unseen (`get().X`,
  // or `pass(env).X` past the call-argument exemption).
  { on: 'shape', re: new RegExp(`(?:\\breturn\\s+|=>\\s*)${ENV_VALUE}\\s*(?=[;,)}\\n]|$)`, 'g') },
  // Audit R15 L-1: an `env` as a branch of a ternary (`x ? env : {}`, `x ? {} : env`), and `process` handed
  // whole to a call (`read(process)`), whose callee then reaches `.env` unseen.
  { on: 'shape', re: new RegExp(`[?:]\\s*${ENV_VALUE}\\s*(?=[:;,)}\\n]|$)`, 'g'), keep: (src, index) => src.shape[index] === '?' || isTernaryElse(src.shape, index) },
  { on: 'shape', re: /[(,]\s*process\s*(?=[),])/g },
];
// The `:` at `index` closes the first branch of a ternary, not an object key or a label: walking back at the
// same bracket depth meets a `?` (neither `?.` nor `??`) before any `,`, `;` or opening bracket.
function isTernaryElse(shape, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const c = shape[i];
    if (')]}'.includes(c)) depth += 1;
    else if ('([{'.includes(c)) {
      if (depth === 0) return false;
      depth -= 1;
    } else if (depth === 0 && (c === ',' || c === ';')) return false;
    else if (depth === 0 && c === '?' && shape[i + 1] !== '.' && shape[i + 1] !== '?' && shape[i - 1] !== '?') return true;
  }
  return false;
}

// `process.env` itself, unless read by name or index (above) …
const PROCESS_ENV = /\bprocess\s*(?:\?\.|\.)\s*env\b(?!\s*(?:\?\.|\.)\s*[A-Za-z_$]|\s*(?:\?\.\s*)?\[)/g;
// … or bound to an identifier named `env`, whose reads the patterns above then see.
const BOUND_TO_ENV = /(?<![\w$.])env\s*=\s*(?:[^;=\n]*\|\|\s*)?$/;

// The indirect accesses `src/` makes today, pinned by count, each checked by hand: a new one fails until it
// is read by name or added here with the reason the names it reaches are covered.
const INDIRECT_READERS = {
  // `process.env` passed to a parameter named `env`: `shapeResponse`, `assertNoTestOnlyKey`, `shouldEnforceHttps`, `init`.
  'src/controllers/settingsController.js': 2,
  'src/index.js': 2,
  'src/utils/accountSecurityServices.js': 1,
  'src/plugins/host.js': 1,
  // `env: vars = env`, handed on to `runQontoConnectionTest` and `ensureWebhookSubscription` as `env`.
  'src/utils/qonto/qontoSettingsController.js': 4,
  // `process.env[name]` for the secrets read back by name (`getOrCreateSecret('X')` above) and the file's keys;
  // `{ ...env }`, the copy `environmentWithoutLocalFile` hands to the self-update child.
  'src/utils/localEnv.js': 12,
  // An `env` that is no process environment (audit R14 L-1): the `{ coreVersion, sdkVersion, hostExports }`
  // a plugin range is checked against, and the Neat environment (`'production'` or `'staging'`).
  'src/plugins/loader.js': 1,
  'src/utils/pluginOffers.js': 2,
  ...(missingPlugins(['neat']).length ? {} : {
    'src/plugins/neat/controller.js': 1,
    'src/plugins/neat/subscriptionRunner.js': 5,
  }),
  // `env[name]` over two `GUESTFLOW_*` names.
  'src/utils/testOnlyKeys.js': 1,
  // `process.env[name]` over `PASS_THROUGH_ENV`, the proxy settings (`HTTPS_PROXY`, `NO_PROXY`…) left to npm;
  // `return env`, the child's own `npm_config_*` object those names are copied into.
  'src/utils/updateStaging.js': 4,
};

// Comments blanked, line breaks kept: a JSDoc naming `process.env` is not an access.
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\/|(?<![:'"`\\])\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, ' '));

// A file's code, with string contents blanked as well for pairing brackets, each `(` paired with its `)`, and
// (audit R15 L-1) each `(` and `{` with the innermost `{` around it, -1 at the top of the file.
function parse(code, file) {
  const shape = code.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (q) => q[0] + q.slice(1, -1).replace(/[^\n]/g, ' ') + q[0]);
  const closeOf = new Map();
  const braceOf = new Map();
  const stack = [];
  const braces = [];
  for (let i = 0; i < shape.length; i += 1) {
    const c = shape[i];
    if (c === '(' || c === '{') braceOf.set(i, braces.length ? braces[braces.length - 1] : -1);
    if ('([{'.includes(c)) {
      stack.push(i);
      if (c === '{') braces.push(i);
    } else if (')]}'.includes(c) && stack.length && shape[stack[stack.length - 1]] === '([{'[')]}'.indexOf(c)]) {
      const open = stack.pop();
      closeOf.set(open, i);
      if (c === '}' && braces[braces.length - 1] === open) braces.pop();
    }
  }
  const openOf = new Map([...closeOf].map(([open, close]) => [close, open]));
  return { file, code, shape, closeOf, openOf, braceOf };
}

// The name a `(` belongs to, `f` in `f(`, `obj.f?.(`, `function f(`, `f = async (` or `f: function (`.
function nameBefore(shape, open) {
  const tokens = shape.slice(Math.max(0, open - 160), open).match(/[\w$]+|\S/g) || [];
  let assigned = false;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const t = tokens[i];
    if (t === 'function' || t === 'async' || t === '*' || (t === '?' && tokens[i + 1] === '.') || (t === '.' && tokens[i - 1] === '?')) continue;
    if ((t === '=' || t === ':') && !assigned) { assigned = true; continue; }
    return /^[A-Za-z_$][\w$]*$/.test(t) ? t : null;
  }
  return null;
}

// The top-level comma-separated items between `open` and its closer, as [start, end) offsets.
function items(src, open) {
  const close = src.closeOf.get(open);
  const out = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i += 1) {
    const c = src.shape[i];
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) { out.push([from, i]); from = i + 1; }
  }
  out.push([from, close]);
  return out;
}

const isParameterList = (src, open) => /^\s*(?:=>|\{)/.test(src.shape.slice(src.closeOf.get(open) + 1, src.closeOf.get(open) + 40));

// The functions a file declares, by name, each declaration with the block it is declared in (`scope`, the `{`
// around it, -1 at the top of the file) and the positions where it declares a parameter named `env`: handing an
// `env` to one is the project's injected-environment pattern, whose reads the scan sees by name in the callee.
function declarations(src) {
  const out = new Map();
  for (const open of src.closeOf.keys()) {
    if (src.shape[open] !== '(' || !isParameterList(src, open)) continue;
    const name = nameBefore(src.shape, open);
    if (!name) continue;
    if (!out.has(name)) out.set(name, []);
    const envAt = new Set();
    items(src, open).forEach(([a, b], position) => {
      if (/^\s*env\s*(?:=|$)/.test(src.code.slice(a, b))) envAt.add(position);
    });
    out.get(name).push({ scope: src.braceOf.get(open), envAt });
  }
  return out;
}

// The positions where `name` declares `env`, as seen from the call whose `(` is at `at` (audit R15 L-1): the
// declaration of the innermost block around the call that declares one, or for a call from another file
// (`at` undefined) the top-level one. With none in sight (a method of an object literal, a function declared in
// a sibling block), every declaration of that name in the file.
function envPositions(src, declared, name, at) {
  const list = declared.get(name);
  for (let b = at === undefined ? -1 : src.braceOf.get(at); ; b = src.braceOf.get(b)) {
    const here = list.filter((d) => d.scope === b);
    if (here.length) return new Set(here.flatMap((d) => [...d.envAt]));
    if (b === -1) return new Set(list.flatMap((d) => [...d.envAt]));
  }
}

const REQUIRE = String.raw`require\(\s*['"]([^'"]+)['"]\s*\)`;

// The names a file binds to a `require`, each to its spec and to the name it has there: `{ a, b: c } =
// require(spec)` binds `a` to `a` and `c` to `b`; `m = require(spec)` binds `m` to the module itself.
function imports(code) {
  const out = new Map();
  for (const m of code.matchAll(new RegExp(String.raw`\{([^{}]*)\}\s*=\s*${REQUIRE}`, 'g'))) {
    for (const part of m[1].split(',')) {
      const bound = part.match(/^\s*([\w$]+)\s*(?::\s*([\w$]+))?\s*(?:=[\s\S]*)?$/);
      if (bound) out.set(bound[2] || bound[1], { spec: m[2], name: bound[1] });
    }
  }
  for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$.])([\w$]+)\s*=\s*${REQUIRE}`, 'g'))) out.set(m[1], { spec: m[2], name: null });
  return out;
}

function resolveRequire(from, spec, byFile) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  return [base, `${base}.js`, `${base}.cjs`, path.join(base, 'index.js')].find((f) => byFile.has(f)) || null;
}

// `name` declares `env` at `position`, in `file` or in the module `file` imports it from.
function declaresEnvAt(file, name, position, byFile, seen = new Set()) {
  const entry = byFile.get(file);
  if (!entry || seen.has(file)) return false;
  seen.add(file);
  if (entry.declared.has(name)) return envPositions(entry.src, entry.declared, name).has(position);
  const bound = entry.imported.get(name);
  const target = bound && bound.name && resolveRequire(file, bound.spec, byFile);
  return Boolean(target) && declaresEnvAt(target, bound.name, position, byFile, seen);
}

// The `env` at `index` is an argument of a call whose callee declares `env` at that position. An `env`
// inside a parameter list, a condition, an object or an array is no call argument at all. The callee is the
// function the call reaches (review of #924, L-2), not any function of `src/` with that name: for `mod.f(` and
// `require(spec).f(`, the `f` of that module; otherwise the `f` the file declares, else the one it imports by
// name. Any other callee (an npm package, an object the scan cannot follow) leaves the argument indirect.
function handedToEnvParameter(src, index, ctx) {
  let depth = 0;
  let open = -1;
  for (let i = index - 1; i >= 0 && open < 0; i -= 1) {
    const c = src.shape[i];
    if (')]}'.includes(c)) depth += 1;
    else if ('([{'.includes(c)) {
      if (depth === 0) open = i;
      else depth -= 1;
    }
  }
  if (open < 0 || src.shape[open] !== '(' || !src.closeOf.has(open) || isParameterList(src, open)) return true;
  const name = nameBefore(src.shape, open);
  if (!name || ['if', 'while', 'for', 'switch', 'return', 'typeof', 'void', 'await', 'catch', 'in', 'of'].includes(name)) return true;
  const position = items(src, open).findIndex(([a, b]) => a <= index && index <= b);
  const from = Math.max(0, open - 200);
  const callee = src.shape.slice(from, open).match(/(?:(\)|[\w$]+)\s*\??\.\s*)?([\w$]+)\s*(?:\?\.\s*)?$/);
  if (!callee || callee[2] !== name) return false;
  const { declared, imported } = ctx.byFile.get(src.file);
  const object = callee[1];
  let target = null;
  if (object === ')') {
    const close = from + callee.index;
    const at = src.openOf.get(close);
    const spec = at !== undefined && /\brequire\s*$/.test(src.shape.slice(Math.max(0, at - 20), at)) && src.code.slice(at + 1, close).match(/^\s*['"]([^'"]+)['"]\s*$/);
    if (!spec) return false;
    target = { spec: spec[1], name };
  } else if (object && imported.has(object) && !imported.get(object).name) {
    target = { spec: imported.get(object).spec, name };
  } else if (declared.has(name)) {
    return envPositions(src, declared, name, open).has(position);
  } else if (!object && imported.has(name) && imported.get(name).name) {
    target = imported.get(name);
  }
  const file = target && resolveRequire(src.file, target.spec, ctx.byFile);
  return Boolean(file) && declaresEnvAt(file, target.name, position, ctx.byFile);
}

// Every environment name `root` reads (comments included, so the list errs on the side of stripping), with the
// files reading it, and every indirect access in its code, by file.
function scanSources(root) {
  const names = new Map();
  const indirect = new Map();
  const files = sourceFiles(root).map((file) => {
    const text = fs.readFileSync(file, 'utf8').replace(REQUIRE_PROCESS, 'process');
    return { file, text, src: parse(withoutComments(text), file) };
  });
  const ctx = { byFile: new Map(files.map(({ file, src }) => [file, { src, declared: declarations(src), imported: imports(src.code) }])) };
  for (const { file, text, src } of files) {
    const rel = path.relative(SERVER_ROOT, file);
    const { code } = src;
    const hits = [];
    const note = (m) => hits.push(`${code.slice(0, m.index).split('\n').length}: ${m[0].trim()}`);
    for (const re of READS) {
      for (const m of text.matchAll(re)) {
        if (!names.has(m[1])) names.set(m[1], []);
        if (!names.get(m[1]).includes(rel)) names.get(m[1]).push(rel);
      }
    }
    for (const { re, on = 'code', keep = () => true } of INDIRECT) {
      for (const m of src[on].matchAll(re)) if (keep(src, m.index, ctx)) note(m);
    }
    for (const m of code.matchAll(PROCESS_ENV)) {
      const lineStart = code.lastIndexOf('\n', m.index) + 1;
      if (!BOUND_TO_ENV.test(code.slice(lineStart, m.index))) note(m);
    }
    if (hits.length) indirect.set(rel, hits);
  }
  return { names, indirect };
}

function guardProblems(root, allowed = INDIRECT_READERS) {
  const { APP_ENV_NAMES, RUNNER_ENV_NAMES } = require(NAMES);
  const listed = new Set([...APP_ENV_NAMES, ...RUNNER_ENV_NAMES]);
  const { names, indirect } = scanSources(root);
  const problems = [...names].filter(([n]) => !n.startsWith('GUESTFLOW_') && !listed.has(n)).map(([n, [f]]) => `${n} unlisted (${f})`);
  for (const [file, hits] of indirect) {
    if (allowed[file] !== hits.length) problems.push(`${file} reaches the environment indirectly: ${hits.join(' | ')}`);
  }
  for (const file of Object.keys(allowed)) if (!indirect.has(file)) problems.push(`${file} no longer reaches it indirectly: drop it`);
  return { problems, names };
}

// A name only removed plugins read is not stale: the plugin removal matrix runs this file with the plugin
// gone (specs/plugin-removal-resilience.md rules 7(a), 19).
function ownedByRemovedPlugins(name) {
  const { PLUGIN_ENV_NAMES } = require(NAMES);
  const owners = Object.keys(PLUGIN_ENV_NAMES).filter((id) => PLUGIN_ENV_NAMES[id].includes(name));
  return owners.length > 0 && missingPlugins(owners).length === owners.length;
}

test('rule 12 (2026-11-01): every variable the app reads is either stripped by the preload or kept for the runner, by name', () => {
  const { APP_ENV_NAMES, RUNNER_ENV_NAMES } = require(NAMES);
  const { problems, names } = guardProblems(SRC);
  assert.ok(names.size > 50, `the scan found ${names.size} names: the patterns no longer match the code`);
  assert.deepEqual(problems, [], 'add each name to APP_ENV_NAMES in tests/setup/appEnvNames.js (RUNNER_ENV_NAMES when the runner needs it), and read process.env.X or env.X by name');
  const stale = APP_ENV_NAMES.filter((n) => !names.has(n) && !ownedByRemovedPlugins(n));
  assert.deepEqual(stale, [], 'no longer read by src/: drop from APP_ENV_NAMES');
  assert.deepEqual([...names.keys()].filter((n) => n.startsWith('GUESTFLOW_TEST_')), [], 'the app never reads a runner knob');
  assert.deepEqual(APP_ENV_NAMES.filter((n) => n.startsWith('GUESTFLOW_') || RUNNER_ENV_NAMES.includes(n)), [], 'GUESTFLOW_* goes by prefix; a name is on one list only');
});

test('rule 12 (2026-11-02, review of #924): a name only a plugin reads is keyed by that plugin, and each name keyed by a shipped plugin is read in its folder', () => {
  const { APP_ENV_NAMES, PLUGIN_ENV_NAMES } = require(NAMES);
  const { names } = scanSources(SRC);
  const shipped = listPlugins();
  // `src/plugins/<id>/…` → `<id>` when it is a shipped plugin's folder.
  const pluginOf = (file) => {
    const [top, dir, id] = file.split(path.sep);
    return top === 'src' && dir === 'plugins' && shipped.includes(id) ? id : undefined;
  };
  const keyed = new Set(Object.values(PLUGIN_ENV_NAMES).flat());
  const problems = [];
  for (const [id, list] of Object.entries(PLUGIN_ENV_NAMES)) {
    if (missingPlugins([id]).length) continue;
    for (const n of list) if (!(names.get(n) || []).some((f) => pluginOf(f) === id)) problems.push(`${n} is not read in the folder of ${id}`);
  }
  for (const n of APP_ENV_NAMES) {
    const files = names.get(n) || [];
    if (keyed.has(n) || !files.length || !files.every(pluginOf)) continue;
    problems.push(`${n} is read only in the folder of ${[...new Set(files.map(pluginOf))].join(', ')}: key it in PLUGIN_ENV_NAMES`);
  }
  assert.deepEqual(problems, []);
});

test('rule 12 (2026-11-01): the preload strips the whole list, and keeps exactly the runner names', () => {
  const { APP_ENV_NAMES, RUNNER_ENV_NAMES } = require(NAMES);
  assert.deepEqual([...RUNNER_ENV_NAMES].sort(), ['DB_PATH', 'NODE_ENV', 'NODE_TEST_CONTEXT', 'PATH', 'PERSISTENT_DB', 'TMPDIR', 'TZ']);
  const shell = Object.fromEntries(APP_ENV_NAMES.map((n) => [n, 'from-shell']));
  const seen = inChild(shell, `console.log(${pickOf(APP_ENV_NAMES)})`);
  assert.deepEqual(Object.entries(seen).filter(([, v]) => v !== null).map(([k]) => k), []);
});

// The forms the review of #920 got past the first guard with, plus the two it already caught, then the
// forms of audit R14 L-1, of the review of #924 and of audit R15 L-1. A form spread over files maps each file name to its code.
const PROBES = {
  'optional chaining on process.env': 'module.exports = () => process.env?.PROBE_X;',
  'optional chaining on an injected env': 'module.exports = (env) => env?.PROBE_X;',
  'an alias of process.env': 'const e = process.env;\nmodule.exports = () => e.PROBE_X;',
  'process destructured to another name': 'const { env: e } = process;\nmodule.exports = () => e.PROBE_X;',
  'a default parameter under another name': 'module.exports = (cfg = process.env) => cfg.PROBE_X;',
  'process.env passed as an argument': 'const read = (cfg) => cfg.PROBE_X;\nmodule.exports = () => read(process.env);',
  'an injected env read by a constant': "const K = 'PROBE_X';\nmodule.exports = (env) => env[K];",
  'an injected env read by optional index': "module.exports = (env, k) => env?.[k];",
  'a backtick key on process.env': 'module.exports = (n) => process.env[`PROBE_${n}`];',
  'a backtick key on an injected env': 'module.exports = (env, n) => env[`PROBE_${n}`];',
  'Reflect.get on process.env': "module.exports = () => Reflect.get(process.env, 'PROBE_X');",
  'Reflect.get on an injected env': "module.exports = (env) => Reflect.get(env, 'PROBE_X');",
  'process indexed by a string': "module.exports = () => process['env'].PROBE_X;",
  'a lowercase name on process.env': 'module.exports = () => process.env.probe_x;',
  'a lowercase name on an injected env': 'module.exports = (env) => env.probe_x !== undefined;',
  'a destructured process.env': 'const { PROBE_X } = process.env;\nmodule.exports = () => PROBE_X;',
  // Audit R14 L-1: what an `env` bound to `process.env` reached past the guard, and `require('process')`.
  'a destructuring of a bound env': 'const env = process.env;\nconst { PROBE_X } = env;\nmodule.exports = () => PROBE_X;',
  'a destructuring of an injected env': 'module.exports = (env = process.env) => { const { PROBE_X } = env; return PROBE_X; };',
  'a destructuring of opts.env': 'module.exports = (opts) => { const { PROBE_X = 1 } = opts.env; return PROBE_X; };',
  'in on an injected env': "module.exports = (env = process.env) => 'PROBE_X' in env;",
  'a spread of an injected env': 'module.exports = (env = process.env) => ({ ...env }).PROBE_X;',
  'an injected env passed to Object.keys': "module.exports = (env = process.env) => Object.keys(env).filter((k) => k.startsWith('PROBE_'));",
  'an injected env passed as an argument': 'const read = (cfg) => cfg.PROBE_X;\nmodule.exports = (env = process.env) => read(env);',
  'an injected env passed among arguments': 'const read = (a, cfg) => cfg.PROBE_X;\nmodule.exports = (env = process.env) => read(1, env);',
  'an alias of an injected env': 'module.exports = (env = process.env) => { const e = env; return e.PROBE_X; };',
  "require('process').env read by name": "module.exports = () => require('process').env.PROBE_X;",
  "require('node:process').env destructured": "const { PROBE_X } = require('node:process').env;\nmodule.exports = () => PROBE_X;",
  "require('process') destructured to another name": "const { env: e } = require('process');\nmodule.exports = () => e.PROBE_X;",
  // Review of #924: an alias with a fallback (L-1), a callee sharing its name with a function of another file
  // that declares `env` (L-2), an `env` that leaves its function whole (L-3).
  'an alias of an injected env with a || fallback': 'module.exports = (env = process.env) => { const e = env || {}; return e.PROBE_X; };',
  'an alias of an injected env with a ?? fallback': 'module.exports = (env = process.env) => { const e = env ?? {}; return e.PROBE_X; };',
  'a local callee named like an env-declaring function elsewhere': {
    'other.js': 'const config = (env) => env.NODE_ENV;\nmodule.exports = { config };',
    'probe.js': 'const config = (cfg) => cfg.PROBE_X;\nmodule.exports = (env = process.env) => config(env);',
  },
  'a local method named like an env-declaring function elsewhere': {
    'other.js': 'module.exports = { available: (env) => env.NODE_ENV };',
    'probe.js': 'const m = { available: (cfg) => cfg.PROBE_X };\nmodule.exports = (env = process.env) => m.available(env);',
  },
  'a package callee named like an env-declaring function of src': {
    'other.js': 'const config = (env) => env.NODE_ENV;\nmodule.exports = { config };',
    'probe.js': "const { config } = require('probe-package');\nmodule.exports = (env = process.env) => config(env);",
  },
  'an imported callee whose module does not declare env there': {
    'other.js': 'const read = (env) => env.NODE_ENV;\nmodule.exports = { read };',
    'lib.js': 'const read = (cfg) => cfg.PROBE_X;\nmodule.exports = { read };',
    'probe.js': "const { read } = require('./lib');\nmodule.exports = (env = process.env) => read(env);",
  },
  'an injected env returned whole': 'const get = (env = process.env) => env;\nmodule.exports = () => get().PROBE_X;',
  'an identity callee declaring env': 'const pass = (env) => env;\nmodule.exports = (env = process.env) => pass(env).PROBE_X;',
  'a function that returns its env': 'function fromIt(env) { return env; }\nmodule.exports = (env = process.env) => fromIt(env).PROBE_X;',
  'an env returned in an object': 'const f = (env = process.env) => ({ env });\nmodule.exports = () => f().env.PROBE_X;',
  // Audit R15 L-1: an `env` as a ternary branch, `process` handed whole to a call, and a callee whose name a
  // nested function also declares with `env` there.
  'an injected env as a ternary branch': 'module.exports = (env = process.env, x) => { const e = x ? env : {}; return e.PROBE_X; };',
  'an injected env as the other ternary branch': 'module.exports = (env = process.env, x) => { const e = x ? {} : env; return e.PROBE_X; };',
  'process handed whole to a call': 'const read = ({ env: { PROBE_X } }) => PROBE_X;\nmodule.exports = () => read(process);',
  'process handed whole among arguments': 'const read = (a, { env: { PROBE_X } }) => PROBE_X;\nmodule.exports = () => read(1, process);',
  'a callee named like a nested function declaring env': 'function outer() { const read = (env) => env.NODE_ENV; return read; }\nconst read = (cfg) => cfg.PROBE_X;\nmodule.exports = { outer, probe: (env = process.env) => read(env) };',
};

const probeRoot = (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-env-probe-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  return tmp;
};

test('rule 12 (2026-11-01, review of #920; 2026-11-02, audit R14 L-1, review of #924 and audit R15 L-1): the guard fails on each probed form of reaching a variable it does not see by name', (t) => {
  const tmp = probeRoot(t);
  const missed = [];
  for (const [form, code] of Object.entries({ ...PROBES, 'a plain read': 'module.exports = () => process.env.PROBE_X;' })) {
    const dir = fs.mkdtempSync(path.join(tmp, 'p-'));
    for (const [name, text] of Object.entries(typeof code === 'string' ? { 'probe.js': code } : code)) fs.writeFileSync(path.join(dir, name), `${text}\n`);
    if (guardProblems(dir, {}).problems.length === 0) missed.push(form);
  }
  assert.deepEqual(missed, [], 'forms the guard lets through');
});

test('rule 12 (2026-11-01, review of #920; 2026-11-02, audit R14 L-1, review of #924 and audit R15 L-1): the forms the app uses on purpose stay quiet', (t) => {
  const dir = probeRoot(t);
  fs.writeFileSync(path.join(dir, 'lib.js'), 'const read = (env) => env.NODE_ENV;\nmodule.exports = { read };\n');
  fs.writeFileSync(path.join(dir, 'reexport.js'), "const { read } = require('./lib');\nmodule.exports = { read };\n");
  fs.writeFileSync(path.join(dir, 'ok.js'), [
    "const path = require('path');",
    "const file = path.join(__dirname, '.env.local');",
    'const a = (env = process.env) => env.PROBE_LISTED;',
    'function b({ env = process.env } = {}) { return env?.PROBE_LISTED; }',
    'const c = (config = {}) => { const env = config.env || process.env; return env.PROBE_LISTED; };',
    "const d = (env) => env['PROBE_LISTED'];",
    'function e(key, env = process.env) { if (!env) return null; return env.PROBE_LISTED || key; }',
    'const f = (env = process.env) => e(1, env) || d(env);',
    'const g = (env) => ({ e, env, f: [f, env] });',
    "const { read } = require('./lib');",
    "const lib = require('./lib');",
    "const { read: again } = require('./reexport');",
    "const h = (env = process.env) => read(env) || lib.read(env) || again(env) || require('./lib').read(env);",
    "const i = () => { throw new Error('PROBE_LISTED not set in env'); };",
    'const inner = (cfg) => cfg;',
    'function j(env = process.env) { const inner = (env) => env.PROBE_LISTED; return inner(env); }',
    'const k = (env = process.env, x) => (x ? env.PROBE_LISTED : null);',
    "const l = (env) => ({ value: env, source: env ? 'env' : 'none' });",
    'module.exports = { file, a, b, c, d, f, g, h, i, inner, j, k, l, nodeEnv: process.env.NODE_ENV };',
    '',
  ].join('\n'));
  const { problems, names } = guardProblems(dir, {});
  assert.deepEqual(problems, ['PROBE_LISTED unlisted (' + path.relative(SERVER_ROOT, path.join(dir, 'ok.js')) + ')']);
  assert.deepEqual([...names.keys()].sort(), ['NODE_ENV', 'PROBE_LISTED']);
});

test('rule 12 (2026-11-01, review of #920): a suite started under pm2 does not see itself supervised', () => {
  const out = inChild({ pm_id: '0' }, `
    const { createRestarter } = require('./src/utils/processRestart');
    console.log(JSON.stringify({ pmId: process.env.pm_id ?? null, supervised: createRestarter().supervised }));
  `);
  assert.deepEqual(out, { pmId: null, supervised: false });
});
