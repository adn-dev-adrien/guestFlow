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
import { execFileSync } from 'node:child_process';
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

export const HOST_MODULES = JSON.parse(fs.readFileSync(path.join(CLIENT_PLUGINS, 'hostModules.json'), 'utf8'));

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

const isHostModule = (request) => HOST_MODULES.includes(request);

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
  };
}

const HOST_PRELUDE = 'const __gfHost=(s)=>{const h=globalThis.__GUESTFLOW_HOST__,m=h&&h.modules[s];'
  + 'if(!m)throw new Error("GuestFlow: module hôte absent "+s);return m};';

function declarationsFor(clause, spec, n) {
  const ns = `__gfm${n}`;
  const out = [`const ${ns}=__gfHost(${JSON.stringify(spec)})`];
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

/**
 * Rule 5 — every static import of a host module becomes a read of the host's own module. Any other
 * bare import left in the bundle is an error: the browser could not resolve it.
 * `imports` is es-module-lexer's parse result for `code`.
 */
export function rewriteHostImports(code, imports, { hostModules = HOST_MODULES } = {}) {
  let out = code;
  let n = 0;
  const sorted = [...imports].sort((a, b) => b.ss - a.ss);
  for (const imp of sorted) {
    const spec = imp.n;
    if (imp.d === -2 || spec === undefined) continue;
    const relative = spec.startsWith('.') || spec.startsWith('/');
    if (relative) continue;
    if (!hostModules.includes(spec)) throw new Error(`bare import "${spec}" left in the bundle`);
    if (imp.d !== -1) throw new Error(`dynamic import of the host module "${spec}"`);
    const stmt = code.slice(imp.ss, imp.se);
    if (!stmt.startsWith('import')) throw new Error(`re-export of the host module "${spec}"`);
    const fromAt = stmt.lastIndexOf('from');
    const replacement = fromAt === -1 ? '' : declarationsFor(stmt.slice(6, fromAt), spec, n);
    n += 1;
    out = out.slice(0, imp.ss) + replacement + out.slice(imp.se).replace(/^;/, '');
  }
  return n ? `${HOST_PRELUDE}${out}` : out;
}

async function buildClient(id, destDir) {
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
      fs.writeFileSync(file, rewriteHostImports(code, imports));
    } catch (err) {
      errors.push(`${id}/client/${path.relative(destDir, file)}: ${err.message}`);
    }
  }
  if (!fs.existsSync(path.join(destDir, 'index.js'))) errors.push(`${id}: no client index.js`);
  return errors;
}

// ── Package ──────────────────────────────────────────────────────────────────

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export async function buildPackage(id, outDir) {
  const { readSourceManifest } = require(path.join(SERVER_PLUGINS, 'manifest.js'));
  const manifest = readSourceManifest(id);
  const stage = path.join(outDir, id);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const errors = [...buildServer(id, path.join(stage, 'server')), ...(await buildClient(id, path.join(stage, 'client')))];
  if (errors.length) throw new Error(`plugin ${id}:\n  ${errors.join('\n  ')}`);
  const file = `${id}-${manifest.version}.tgz`;
  // COPYFILE_DISABLE: macOS tar would otherwise add AppleDouble `._*` members the instance refuses.
  execFileSync('tar', ['-czf', path.join(outDir, file), '-C', stage, 'manifest.json', 'server', 'client'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
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
  for (const id of only) {
    built.push(await buildPackage(id, outDir)); // eslint-disable-line no-await-in-loop
    process.stdout.write(`✓ ${built[built.length - 1].file}\n`);
  }
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
