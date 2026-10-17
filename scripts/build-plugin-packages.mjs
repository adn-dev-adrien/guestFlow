#!/usr/bin/env node
/**
 * Builds one package per plugin (specs/plugins-phase-4-registry.md rules 1, 4, 5, 23).
 *
 *   node scripts/build-plugin-packages.mjs [--out plugins-dist] [--only id,id]
 *
 * For each plugin, `<out>/<id>-<version>.tgz` holds:
 *   manifest.json   the plugin's manifest (server/src/plugins/<id>/manifest.json, rule 2)
 *   server/         its server folder without tests, CommonJS, no node_modules; every require that
 *                   reaches the SDK is rewritten to `guestflow/sdk`, any other require leaving the
 *                   folder fails the build, and an npm package must be one the core already ships
 *   client/         one ES module `index.js` plus its chunks, built by Vite with React, the router,
 *                   MUI and the SDK as externals resolved at run time to the host's own modules
 *                   (client/src/plugins/hostModules.json, runtime.js); icons are bundled
 * `<out>/<id>/` is the same package unpacked — what a `bundled` row runs from — and
 * `<out>/SHA256SUMS` lists the archives.
 *
 * The rewrite and boundary functions are exported pure, for the unit suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { builtinModules, createRequire } from 'node:module';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PLUGINS = path.join(ROOT, 'server', 'src', 'plugins');
const SERVER_SDK = path.join(SERVER_PLUGINS, 'sdk');
const CLIENT = path.join(ROOT, 'client');
const CLIENT_PLUGINS = path.join(CLIENT, 'src', 'plugins');
const CLIENT_SDK = path.join(CLIENT_PLUGINS, 'sdk');
const SDK_REQUEST = 'guestflow/sdk';

const require = createRequire(import.meta.url);
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

// What the host exposes, by module: `"*"` (the whole namespace) or the exact names (M1/M3 of the PR
// review, 2026-10-17). Generated with `--write-host` from what the plugins actually import, together
// with client/src/plugins/hostModules.js, which imports exactly those names — so the app does not
// load the whole of MUI eagerly just in case a plugin needs it.
const HOST_JSON = path.join(CLIENT_PLUGINS, 'hostModules.json');
const HOST_JS = path.join(CLIENT_PLUGINS, 'hostModules.js');
export const HOST_EXPORTS = JSON.parse(fs.readFileSync(HOST_JSON, 'utf8'));
export const HOST_MODULES = Object.keys(HOST_EXPORTS);
// Always whole: small, and React's namespace is what JSX compiles against.
// The SDK too (second review, M-B): it is GuestFlow's own contract with every plugin, versioned, so a
// plugin version built later may use any of its entries.
const WHOLE = new Set(['react', 'react/jsx-runtime', SDK_REQUEST, `${SDK_REQUEST}/ui`]);
// Packages the host owns: a plugin never carries a copy of them, whoever imports them (an icon imports
// `@mui/material/SvgIcon`, which pulls @mui/system and emotion — one copy, one theme).
const HOST_PACKAGE = /^(react|react-dom|react-router|@mui\/material|@mui\/system|@mui\/utils|@mui\/styled-engine|@mui\/private-theming|@emotion\/[^/]+)(\/.*)?$/;
// The only npm code a plugin bundle may carry.
const BUNDLED_NPM = /\/node_modules\/@mui\/icons-material\//;

// ── Server ───────────────────────────────────────────────────────────────────

const packageName = (request) => (request.startsWith('@') ? request.split('/').slice(0, 2).join('/') : request.split('/')[0]);

/**
 * Rule 4, server side: rewrite the requires of one plugin file. `file` and `pluginDir` are absolute.
 * → { code, errors[] }
 */
export function rewriteServerRequires(source, { file, pluginDir, sdkDir = SERVER_SDK, dependencies = [] }) {
  const errors = [];
  const code = String(source).replace(/require\(\s*(['"])([^'"]+)\1\s*\)/g, (whole, quote, request) => {
    if (request.startsWith('.')) {
      const target = path.resolve(path.dirname(file), request);
      if (target === pluginDir || target.startsWith(`${pluginDir}${path.sep}`)) return whole;
      if (target === sdkDir || target.startsWith(`${sdkDir}${path.sep}`)) {
        const sub = path.relative(sdkDir, target).split(path.sep).join('/').replace(/\.js$/, '');
        return `require(${quote}${!sub || sub === 'index' ? SDK_REQUEST : `${SDK_REQUEST}/${sub}`}${quote})`;
      }
      errors.push(`${path.relative(ROOT, file)} requires ${request}, outside its folder and the SDK`);
      return whole;
    }
    if (BUILTINS.has(request) || dependencies.includes(packageName(request))) return whole;
    errors.push(`${path.relative(ROOT, file)} requires the npm package ${request}, which the core does not ship`);
    return whole;
  });
  return { code, errors };
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'tests' && e.name !== '__tests__' && e.name !== 'node_modules') walk(full, acc);
    } else if (e.name !== 'manifest.json' && !e.name.startsWith('.')) {
      acc.push(full);
    }
  }
  return acc;
}

function buildServer(id, destDir) {
  const pluginDir = path.join(SERVER_PLUGINS, id);
  const dependencies = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'package.json'), 'utf8')).dependencies || {});
  const errors = [];
  for (const file of walk(pluginDir)) {
    const dest = path.join(destDir, path.relative(pluginDir, file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (!file.endsWith('.js')) {
      fs.copyFileSync(file, dest);
      continue;
    }
    const out = rewriteServerRequires(fs.readFileSync(file, 'utf8'), { file, pluginDir, dependencies });
    errors.push(...out.errors);
    fs.writeFileSync(dest, out.code);
  }
  if (!fs.existsSync(path.join(destDir, 'index.js'))) errors.push(`${id}: no server index.js`);
  return errors;
}

// ── Client ───────────────────────────────────────────────────────────────────

const isHostModule = (request) => request === SDK_REQUEST || request.startsWith(`${SDK_REQUEST}/`) || HOST_PACKAGE.test(request);

/**
 * Rules 4–5, client side: what an import from a plugin file may be. → { external } | { bundle } | { error }
 */
export function classifyClientImport(source, importer, { pluginDir, sdkDir = CLIENT_SDK } = {}) {
  const fromPlugin = importer && (importer.startsWith(`${pluginDir}${path.sep}`));
  if (source.startsWith('.') || path.isAbsolute(source)) {
    if (!fromPlugin) return { bundle: true };
    const target = path.resolve(path.dirname(importer), source).replace(/\.(jsx?|tsx?)$/, '');
    if (target.startsWith(`${pluginDir}${path.sep}`)) return { bundle: true };
    if (target === sdkDir || target === path.join(sdkDir, 'index')) return { external: SDK_REQUEST };
    if (target === path.join(sdkDir, 'ui')) return { external: `${SDK_REQUEST}/ui` };
    return { error: `${path.relative(ROOT, importer)} imports ${source}, outside its folder and the SDK` };
  }
  if (isHostModule(source)) return { external: source };
  if (!fromPlugin) return { bundle: true };
  if (source.startsWith('@mui/icons-material/')) return { bundle: true };
  return { error: `${path.relative(ROOT, importer)} imports ${source}: a plugin imports React, the router, MUI, its icons and the SDK only` };
}

/** Rule 5 (review M1) — the npm modules inside a bundle: only the icons may be there. → [offending ids] */
export function strayBundledModules(moduleIds) {
  return moduleIds.filter((m) => m.includes('/node_modules/') && !BUNDLED_NPM.test(m));
}

function boundaryPlugin(id) {
  const pluginDir = path.join(CLIENT_PLUGINS, id);
  return {
    name: 'guestflow-plugin-boundary',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null;
      const verdict = classifyClientImport(source, importer, { pluginDir });
      if (verdict.error) this.error(verdict.error);
      if (verdict.external) return { id: verdict.external, external: true };
      return null;
    },
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((chunk) => chunk.moduleIds || []);
      const stray = strayBundledModules(ids);
      if (stray.length) this.error(`${id}: the bundle carries host code (one MUI, one theme): ${stray.slice(0, 5).map((m) => m.split('/node_modules/')[1]).join(', ')}`);
    },
  };
}

// A bundle built against a newer app may need a name this app does not expose: it then fails to load,
// with a clear message, instead of rendering `undefined` (rule 26).
const HOST_PRELUDE = 'const __gfHost=(s,n)=>{const h=globalThis.__GUESTFLOW_HOST__,m=h&&h.modules[s];'
  + 'if(!m)throw new Error("GuestFlow: module hôte absent "+s);'
  + 'for(const k of n||[])if(!(k in m))throw new Error("GuestFlow: "+s+" n’expose pas "+k);return m};';

// The names an import clause takes from its module: 'default', '*' or the exported names.
export function clauseNames(clause) {
  let rest = clause.trim();
  const names = [];
  if (rest && !rest.startsWith('{') && !rest.startsWith('*')) {
    names.push('default');
    const comma = rest.indexOf(',');
    rest = comma === -1 ? '' : rest.slice(comma + 1).trim();
  }
  if (rest.startsWith('*')) names.push('*');
  if (rest.startsWith('{')) {
    rest.replace(/^\{|\}$/g, '').split(',').map((x) => x.trim()).filter(Boolean)
      .forEach((part) => names.push(part.split(/\s+as\s+/)[0].replace(/^["']|["']$/g, '')));
  }
  return names;
}

function declarationsFor(clause, spec, n) {
  const ns = `__gfm${n}`;
  const needed = clauseNames(clause).filter((name) => name !== '*' && name !== 'default');
  const out = [`const ${ns}=__gfHost(${JSON.stringify(spec)}${needed.length ? `,${JSON.stringify(needed)}` : ''})`];
  let rest = clause.trim();
  if (rest && !rest.startsWith('{') && !rest.startsWith('*')) {
    const comma = rest.indexOf(',');
    const name = (comma === -1 ? rest : rest.slice(0, comma)).trim();
    out.push(`const ${name}=${ns}.default!==undefined?${ns}.default:${ns}`);
    rest = comma === -1 ? '' : rest.slice(comma + 1).trim();
  }
  if (rest.startsWith('*')) {
    const m = rest.match(/^\*\s*as\s+([\w$]+)$/);
    if (!m) throw new Error(`unsupported import clause: ${clause}`);
    out.push(`const ${m[1]}=${ns}`);
  } else if (rest.startsWith('{')) {
    const inner = rest.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
      .map((part) => {
        const m = part.match(/^([\w$]+|"[^"]+"|'[^']+')(?:\s+as\s+([\w$]+))?$/);
        if (!m) throw new Error(`unsupported import specifier: ${part}`);
        return m[2] ? `${m[1]}:${m[2]}` : m[1];
      });
    if (inner.length) out.push(`const{${inner.join(',')}}=${ns}`);
  } else if (rest) {
    throw new Error(`unsupported import clause: ${clause}`);
  }
  return `${out.join(';')};`;
}

// `export { a as b } from 'host'` — a chunk re-exporting a host name to the other chunks (the icons of
// @mui/icons-material ≥ 9.5 re-export `createSvgIcon` from '@mui/material/SvgIcon'). → { names, code }
function reexportFor(clause, spec, n) {
  const ns = `__gfm${n}`;
  const inner = clause.trim();
  if (!inner.startsWith('{')) throw new Error(`unsupported re-export of the host module "${spec}"`);
  const parts = inner.replace(/^\{|\}$/g, '').split(',').map((x) => x.trim()).filter(Boolean).map((part) => {
    const m = part.match(/^([\w$]+)(?:\s+as\s+([\w$]+))?$/);
    if (!m) throw new Error(`unsupported re-export specifier: ${part}`);
    return { from: m[1], as: m[2] || m[1] };
  });
  const names = parts.map((x) => x.from);
  const needed = names.filter((name) => name !== 'default');
  const decls = parts.map((x, i) => `const __gfx${n}_${i}=${x.from === 'default' ? `${ns}.default!==undefined?${ns}.default:${ns}` : `${ns}.${x.from}`}`);
  const code = `const ${ns}=__gfHost(${JSON.stringify(spec)}${needed.length ? `,${JSON.stringify(needed)}` : ''});${decls.join(';')};`
    + `export{${parts.map((x, i) => `__gfx${n}_${i} as ${x.as}`).join(',')}};`;
  return { names, code };
}

/**
 * Rule 5 — every static import of a host module becomes a read of the host's own module. Any other
 * bare import left in the bundle is an error: the browser could not resolve it.
 * `imports` is es-module-lexer's parse result for `code`.
 */
export function rewriteHostImports(code, imports, { hostModules = HOST_MODULES, usage = null } = {}) {
  let out = code;
  let n = 0;
  const sorted = [...imports].sort((a, b) => b.ss - a.ss);
  for (const imp of sorted) {
    const spec = imp.n;
    if (imp.d === -2 || spec === undefined) continue;
    const relative = spec.startsWith('.') || spec.startsWith('/');
    if (relative) continue;
    if (!usage && !hostModules.includes(spec)) throw new Error(`bare import "${spec}" left in the bundle`);
    if (imp.d !== -1) throw new Error(`dynamic import of the host module "${spec}"`);
    const stmt = code.slice(imp.ss, imp.se);
    if (stmt.startsWith('export')) {
      const fromAt = stmt.lastIndexOf('from');
      const { names, code: replacement } = reexportFor(stmt.slice(6, fromAt), spec, n);
      if (usage) {
        if (!usage[spec]) usage[spec] = new Set();
        names.forEach((name) => usage[spec].add(name));
      }
      n += 1;
      out = out.slice(0, imp.ss) + replacement + out.slice(imp.se).replace(/^;/, '');
      continue;
    }
    if (!stmt.startsWith('import')) throw new Error(`re-export of the host module "${spec}"`);
    const fromAt = stmt.lastIndexOf('from');
    if (usage) {
      if (!usage[spec]) usage[spec] = new Set();
      if (fromAt !== -1) clauseNames(stmt.slice(6, fromAt)).forEach((name) => usage[spec].add(name));
    }
    const replacement = fromAt === -1 ? '' : declarationsFor(stmt.slice(6, fromAt), spec, n);
    n += 1;
    out = out.slice(0, imp.ss) + replacement + out.slice(imp.se).replace(/^;/, '');
  }
  return n ? `${HOST_PRELUDE}${out}` : out;
}

/**
 * Review M1/M3 — every name a bundle takes from the host must be one the host exposes. → [missing]
 * `usage`: spec → Set(names); `exports`: spec → '*' | [names].
 */
export function missingHostExports(usage, exports = HOST_EXPORTS) {
  const missing = [];
  for (const [spec, names] of Object.entries(usage)) {
    const exposed = exports[spec];
    if (exposed === undefined) { missing.push(`${spec} (module)`); continue; }
    if (exposed === '*') continue;
    for (const name of names) {
      if (name === '*') missing.push(`${spec} (whole namespace)`);
      else if (!exposed.includes(name)) missing.push(`${spec}#${name}`);
    }
  }
  return missing;
}

/**
 * The host module file for `usage` (spec → Set(names)): the exact imports, nothing eager beyond them.
 * `previous` (the committed list) is kept whole: the list only grows (rule 33), so a plugin version
 * already published never loses a name it relies on.
 */
export function hostModulesSource(usage, previous = {}) {
  const merged = {};
  for (const [spec, names] of Object.entries(previous)) merged[spec] = new Set(names === '*' ? ['*'] : names);
  for (const [spec, names] of Object.entries(usage)) names.forEach((n) => (merged[spec] ||= new Set()).add(n));
  const all = merged;
  const specs = [...new Set([...Object.keys(all), ...WHOLE])].sort();
  const json = {};
  const lines = ['// Generated by `node scripts/build-plugin-packages.mjs --write-host` — do not edit by hand.',
    '// What the plugin bundles read from the app (specs/plugins-phase-4-registry.md rules 5, 26): exactly',
    '// the names they import, so the app loads no part of MUI only for them.'];
  const entries = [];
  const local = (spec) => (spec === SDK_REQUEST ? './sdk' : spec === `${SDK_REQUEST}/ui` ? './sdk/ui' : spec);
  specs.forEach((spec, i) => {
    const names = [...(all[spec] || [])].filter((nm) => nm !== '*').sort();
    if (WHOLE.has(spec)) {
      json[spec] = '*';
      lines.push(`import * as M${i} from '${local(spec)}';`);
      entries.push(`  '${spec}': M${i},`);
      return;
    }
    json[spec] = names;
    const named = names.filter((nm) => nm !== 'default');
    const parts = [];
    if (names.includes('default')) parts.push(`D${i}`);
    if (named.length) parts.push(`{ ${named.map((nm) => `${nm} as M${i}_${nm}`).join(', ')} }`);
    if (parts.length) lines.push(`import ${parts.join(', ')} from '${local(spec)}';`);
    const fields = [...(names.includes('default') ? [`default: D${i}`] : []), ...named.map((nm) => `${nm}: M${i}_${nm}`)];
    entries.push(`  '${spec}': Object.freeze({ ${fields.join(', ')} }),`);
  });
  lines.push('', 'export const HOST_MODULES = Object.freeze({', ...entries, '});', '');
  return { js: lines.join('\n'), json };
}

async function buildClient(id, destDir, usage) {
  const clientRequire = createRequire(path.join(CLIENT, 'package.json'));
  const modulesDir = path.join(CLIENT, 'node_modules');
  const vite = await import(pathToFileURL(path.join(modulesDir, 'vite', 'dist', 'node', 'index.js')).href);
  const react = (await import(pathToFileURL(path.join(modulesDir, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default;
  const lexer = await import(pathToFileURL(clientRequire.resolve('es-module-lexer')).href);
  await vite.build({
    configFile: false,
    root: CLIENT,
    logLevel: 'warn',
    publicDir: false,
    plugins: [boundaryPlugin(id), react({ include: /\.(jsx?|tsx?)$/ })],
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), global: 'globalThis' },
    build: {
      outDir: destDir,
      emptyOutDir: true,
      sourcemap: false,
      minify: true,
      copyPublicDir: false,
      lib: { entry: path.join(CLIENT_PLUGINS, id, 'index.js'), formats: ['es'], fileName: () => 'index.js' },
      rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' } },
    },
  });
  await lexer.init;
  const errors = [];
  for (const file of walk(destDir).filter((f) => f.endsWith('.js'))) {
    const code = fs.readFileSync(file, 'utf8');
    try {
      const [imports] = lexer.parse(code);
      fs.writeFileSync(file, rewriteHostImports(code, imports, { usage }));
    } catch (err) {
      errors.push(`${id}/client/${path.relative(destDir, file)}: ${err.message}`);
    }
  }
  if (!fs.existsSync(path.join(destDir, 'index.js'))) errors.push(`${id}: no client index.js`);
  return errors;
}

// ── Package ──────────────────────────────────────────────────────────────────

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ── A reproducible archive (second review, m5) ───────────────────────────────
// ustar written by hand: names sorted, mtime 0, owner 0, modes 0644/0755, gzip without a timestamp —
// the same files always give the same bytes, on macOS as on the CI runner.

function tarHeader(name, size, type) {
  const h = Buffer.alloc(512);
  let base = name;
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 154);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
    if (Buffer.byteLength(base) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`path too long for a package: ${name}`);
  }
  const put = (str, offset, len) => h.write(str, offset, len, 'utf8');
  const oct = (n, len) => `${n.toString(8).padStart(len - 1, '0')}\0`;
  put(base, 0, 100);
  put(oct(type === '5' ? 0o755 : 0o644, 8), 100, 8);
  put(oct(0, 8), 108, 8);
  put(oct(0, 8), 116, 8);
  put(oct(size, 12), 124, 12);
  put(oct(0, 12), 136, 12);
  put('        ', 148, 8);
  put(type, 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return h;
}

/** The `.tgz` of `dir`'s `entries` (manifest.json, server, client), byte for byte reproducible. */
export function reproducibleTgz(dir, entries) {
  const names = [];
  const visit = (rel) => {
    const full = path.join(dir, rel);
    if (fs.statSync(full).isDirectory()) {
      names.push(`${rel}/`);
      fs.readdirSync(full).sort().forEach((child) => visit(`${rel}/${child}`));
    } else {
      names.push(rel);
    }
  };
  [...entries].sort().forEach(visit);
  const blocks = [];
  for (const name of names) {
    if (name.endsWith('/')) { blocks.push(tarHeader(name, 0, '5')); continue; }
    const data = fs.readFileSync(path.join(dir, name));
    blocks.push(tarHeader(name, data.length, '0'), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
}

/** A hash of the package's files, independent of tar and timestamps (review M2). */
export function contentHash(dir) {
  const hash = crypto.createHash('sha256');
  walk(dir).map((f) => path.relative(dir, f).split(path.sep).join('/')).sort().forEach((rel) => {
    if (rel === 'manifest.json') return;
    hash.update(rel).update('\0').update(fs.readFileSync(path.join(dir, rel))).update('\0');
  });
  return hash.digest('hex');
}

export async function buildPackage(id, outDir, usage = {}) {
  const own = {};
  const { readSourceManifest } = require(path.join(SERVER_PLUGINS, 'manifest.js'));
  const manifest = readSourceManifest(id);
  const stage = path.join(outDir, id);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const errors = [...buildServer(id, path.join(stage, 'server')), ...(await buildClient(id, path.join(stage, 'client'), own))];
  if (errors.length) throw new Error(`plugin ${id}:\n  ${errors.join('\n  ')}`);
  // The package's manifest records what was built, so a release can tell a changed bundle that kept
  // its version (scripts/check-plugin-versions.mjs --built).
  // `hostImports` — what the bundle takes from the app — lets an instance refuse a version its own
  // app cannot serve (rule 33).
  for (const [spec, names] of Object.entries(own)) names.forEach((n) => (usage[spec] ||= new Set()).add(n));
  const hostImports = Object.fromEntries(Object.entries(own).sort(([a], [b]) => a.localeCompare(b))
    .map(([spec, names]) => [spec, [...names].sort()]));
  fs.writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify({ ...manifest, hostImports, contentHash: contentHash(stage) }, null, 2)}\n`);
  const file = `${id}-${manifest.version}.tgz`;
  fs.writeFileSync(path.join(outDir, file), reproducibleTgz(stage, ['manifest.json', 'server', 'client']));
  return { id, version: manifest.version, file, sha256: sha256File(path.join(outDir, file)) };
}

async function main() {
  const args = process.argv.slice(2);
  const at = (flag) => { const i = args.indexOf(flag); return i === -1 ? null : args[i + 1]; };
  const outDir = path.resolve(ROOT, at('--out') || 'plugins-dist');
  const { PLUGIN_IDS } = require(path.join(ROOT, 'server', 'src', 'constants', 'plugins.js'));
  const only = at('--only') ? at('--only').split(',') : PLUGIN_IDS;
  if (!at('--only')) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const built = [];
  const usage = {};
  for (const id of only) {
    built.push(await buildPackage(id, outDir, usage)); // eslint-disable-line no-await-in-loop
    process.stdout.write(`✓ ${built[built.length - 1].file}\n`);
  }
  if (args.includes('--write-host')) {
    const { js, json } = hostModulesSource(usage, HOST_EXPORTS);
    fs.writeFileSync(HOST_JS, js);
    fs.writeFileSync(HOST_JSON, `${JSON.stringify(json, null, 2)}\n`);
    process.stdout.write(`host modules written: ${path.relative(ROOT, HOST_JS)}\n`);
  } else {
    const missing = missingHostExports(usage);
    if (missing.length) {
      throw new Error(`the host does not expose: ${missing.join(', ')}\nRun: node scripts/build-plugin-packages.mjs --write-host (and rebuild the client)`);
    }
  }
  // The app this release ships exposes these names; the instance compares a package's `hostImports`
  // with this copy (rule 33).
  fs.copyFileSync(HOST_JSON, path.join(outDir, 'hostModules.json'));
  const sums = fs.readdirSync(outDir).filter((f) => f.endsWith('.tgz')).sort()
    .map((f) => `${sha256File(path.join(outDir, f))}  ${f}`);
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
  process.stdout.write(`${built.length} package(s) in ${path.relative(ROOT, outDir) || '.'}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}
