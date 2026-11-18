// specs/pricing-components.md rule 48 (reading of 2026-11-18, loop t19) — one compiled statement per SQL text and database
// handle: `db.prepare(sql)` hands back the statement it already compiled, the cache empties when the schema changes, a text
// that fails to compile is never kept, the cache is bounded, the stay-write trail still sees each UPDATE once, and no
// module of server/src or scripts/ sets a statement mode a cached statement would share with another caller (the guard and
// its self-test: loop t20 O20-1).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const statementCache = require('../utils/statementCache');
const stayWriteTrail = require('../utils/stayWriteTrail');

function fresh() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE reservations (id INTEGER PRIMARY KEY, updatedAt TEXT); INSERT INTO reservations VALUES (1, 'v0'), (2, 'w0')");
  stayWriteTrail.install(db);
  statementCache.install(db);
  return db;
}

test('rule 48 — the same text gives the same compiled statement, another text another one; install is idempotent', () => {
  const db = fresh();
  const sql = 'SELECT * FROM reservations WHERE id = ?';
  const first = db.prepare(sql);
  statementCache.install(db);
  assert.equal(db.prepare(sql), first);
  assert.notEqual(db.prepare('SELECT id FROM reservations WHERE id = ?'), first);
  assert.deepEqual(db.prepare(sql).get(2), { id: 2, updatedAt: 'w0' });
});

test('rule 48 — a schema change empties the cache: a dropped table throws at prepare, an added column is read', () => {
  const db = fresh();
  db.exec('CREATE TABLE extra (id INTEGER PRIMARY KEY)');
  const read = 'SELECT * FROM extra';
  db.prepare(read);
  db.exec('DROP TABLE extra');
  assert.throws(() => db.prepare(read), /no such table/);
  const all = 'SELECT * FROM reservations WHERE id = 1';
  const before = db.prepare(all);
  db.exec('ALTER TABLE reservations ADD COLUMN note TEXT');
  const after = db.prepare(all);
  assert.notEqual(after, before);
  assert.deepEqual(after.get(), { id: 1, updatedAt: 'v0', note: null });
});

test('rule 48 — a text that fails to compile is not kept: it fails again, then compiles once the table exists', () => {
  const db = fresh();
  const sql = 'SELECT * FROM later';
  assert.throws(() => db.prepare(sql), /no such table/);
  assert.throws(() => db.prepare(sql), /no such table/);
  db.exec('CREATE TABLE later (id INTEGER)');
  assert.deepEqual(db.prepare(sql).all(), []);
});

test('rule 48 — the cache is bounded: the least recently used text is compiled again', () => {
  const db = fresh();
  const first = db.prepare('SELECT 0 AS n');
  for (let i = 1; i <= statementCache.LIMIT; i += 1) db.prepare(`SELECT ${i} AS n`);
  assert.notEqual(db.prepare('SELECT 0 AS n'), first, 'the oldest text was dropped');
  const recent = db.prepare(`SELECT ${statementCache.LIMIT} AS n`);
  assert.equal(db.prepare(`SELECT ${statementCache.LIMIT} AS n`), recent);
});

test('reservation-fiche-concurrency rule 8 still holds through the cache: each UPDATE of a stay is trailed once', () => {
  const db = fresh();
  const sql = 'UPDATE reservations SET updatedAt = ? WHERE id = ?';
  assert.equal(db.prepare(sql).run, db.prepare(sql).run, 'the trail wraps the cached statement once');
  const moved = stayWriteTrail.collect((store) => {
    db.prepare(sql).run('v1', 1);
    db.prepare(sql).run('v2', 1);
    return [...store.moved.values()];
  });
  assert.deepEqual(moved, [{ id: 1, before: 'v0', after: 'v2', broken: false }]);
});

// The statement modes a cached statement would share with every other caller of its text (rule 48). `pluck`, `expand`,
// `safeIntegers` and `iterate` are better-sqlite3 names, flagged on any receiver; `raw` and `bind` are common names elsewhere
// (`settings.raw(key)`, `fn.bind(this)`), flagged only on a statement: chained on `prepare(…)` — after any argument, across
// lines, through a chain — or on a name assigned from `prepare(…)` in the same file. Comments and string contents are blanked
// first, keeping every offset, so a call written in a comment or a SQL text is not one, and an offender is reported by line.
const MODES = ['bind', 'raw', 'pluck', 'expand', 'safeIntegers', 'iterate'];
const ANY_RECEIVER = /\.\s*(pluck|expand|safeIntegers|iterate)\s*\(/g;

function blankComments(source) {
  const out = source.split('');
  const blank = (from, to) => { for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' '; };
  let template;
  // Code from `start`; inside a template's `${…}` it stops at the brace that closes it, and answers where it stopped.
  const code = (start, inTemplate) => {
    let i = start;
    let depth = 0;
    let regexAllowed = true;
    while (i < source.length) {
      const c = source[i];
      const next = source[i + 1];
      if (inTemplate && c === '}' && depth === 0) return i;
      if (c === '/' && next === '/') {
        const end = source.indexOf('\n', i);
        blank(i, end === -1 ? source.length : end);
        i = end === -1 ? source.length : end;
      } else if (c === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2);
        blank(i, end === -1 ? source.length : end + 2);
        i = end === -1 ? source.length : end + 2;
      } else if (c === '`') {
        i = template(i);
        regexAllowed = false;
      } else if (c === '\'' || c === '"') {
        let j = i + 1;
        while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
        blank(i + 1, j);
        i = j + 1;
        regexAllowed = false;
      } else if (c === '/' && regexAllowed) {
        let j = i + 1;
        let inClass = false;
        while (j < source.length && source[j] !== '\n' && (inClass || source[j] !== '/')) {
          if (source[j] === '\\') j += 1;
          else if (source[j] === '[') inClass = true;
          else if (source[j] === ']') inClass = false;
          j += 1;
        }
        blank(i + 1, j);
        i = j + 1;
        regexAllowed = false;
      } else {
        if (c === '{') depth += 1;
        if (c === '}') depth -= 1;
        if (!/\s/.test(c)) regexAllowed = /[(,=:[!&|?{};+\-*%<>~^]/.test(c);
        i += 1;
      }
    }
    return i;
  };
  // A template's text is blanked; the code of its `${…}` parts is read like any other code.
  template = (start) => {
    let j = start + 1;
    let from = j;
    while (j < source.length && source[j] !== '`') {
      if (source[j] === '\\') j += 2;
      else if (source[j] === '$' && source[j + 1] === '{') {
        blank(from, j);
        j = code(j + 2, true) + 1;
        from = j;
      } else j += 1;
    }
    blank(from, j);
    return j + 1;
  };
  code(0, false);
  return out.join('');
}

function closingParen(code, open) {
  let depth = 0;
  for (let k = open; k < code.length; k += 1) {
    if (code[k] === '(') depth += 1;
    else if (code[k] === ')') { depth -= 1; if (depth === 0) return k; }
  }
  return code.length;
}

function statementModeCalls(source) {
  const code = blankComments(source);
  const found = new Set();
  const lineOf = (index) => code.slice(0, index).split('\n').length;
  for (const m of code.matchAll(ANY_RECEIVER)) found.add(lineOf(m.index));
  // Chained on prepare(…): walk the chain that follows the call, whatever its argument and its line breaks.
  for (const m of code.matchAll(/(?<![\w$])prepare\s*\(/g)) {
    let k = closingParen(code, m.index + m[0].length - 1) + 1;
    for (;;) {
      const link = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(code.slice(k));
      if (!link) break;
      if (MODES.includes(link[1])) found.add(lineOf(k + link[0].indexOf(link[1])));
      k = closingParen(code, k + link[0].length - 1) + 1;
    }
  }
  // On a name (or this.name) assigned from prepare(…).
  const receivers = new Set();
  for (const m of code.matchAll(/((?:this\s*\.\s*)?[A-Za-z_$][\w$]*)\s*(?<![=!<>])=(?![=>])\s*(?:[\w$]+\s*(?:\(\s*\))?\s*\.\s*)*prepare\s*\(/g)) {
    receivers.add(m[1].replace(/\s+/g, ''));
  }
  for (const receiver of receivers) {
    const name = receiver.split('.').map((part) => part.replace(/\$/g, '\\$')).join('\\s*\\.\\s*');
    for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${name}\\s*\\.\\s*(${MODES.join('|')})\\s*\\(`, 'g'))) found.add(lineOf(m.index));
  }
  return [...found].sort((a, b) => a - b);
}

test('rule 48 — the mode guard catches every form: any argument, across lines, through a chain, on a named statement', () => {
  const caught = [
    "db.prepare(sql).raw(1).all();",
    "db.prepare(sql).raw(true).all();",
    "db.prepare(sql).raw().all();",
    "db.prepare(sql).raw(flag).all();",
    "db\n  .prepare(\n    'SELECT id FROM t WHERE a = ?'\n  )\n  .bind(\n    1,\n  );",
    "db.prepare(`SELECT ${columns(x).join(', ')} FROM t`).bind(2).get();",
    "const sql = `SELECT ${db.prepare('PRAGMA table_info(t)').raw(true).all().length} AS n`;",
    "const text = `a ${`b ${db.prepare(sql).pluck().get()}`} c`;",
    "db.prepare('SELECT (1)').get;\ndb.prepare(\"SELECT ')' AS p\").raw(true);",
    "const read = db.prepare(sql);\nread.raw(1);",
    "let read;\nread = db.prepare(sql);\nread\n  .bind(3);",
    "this.read = this.db.prepare(sql);\nthis.read.raw(true);",
    "const read = getDb().prepare(sql);\nread.bind(1);",
    "rows.pluck();",
    "stmt\n  .iterate()",
    "s.safeIntegers(true)",
    "s.expand()",
  ];
  for (const source of caught) assert.notDeepEqual(statementModeCalls(source), [], source);
  const missed = [
    "settings.raw('qontoRefreshTokenEncrypted');",
    "require('../models/pluginSettingsModel').raw(pluginId, key);",
    "const handler = fn.bind(this);",
    "const prepare = db.prepare.bind(db);",
    "// db.prepare(sql).raw(true)\n/* read.bind(1); stmt.pluck() */",
    "const sql = 'SELECT 1'; db.prepare(sql).get(); const text = \"prepare(x).raw(1)\";",
    "const re = /prepare\\(x\\)\\.raw\\(/; String.raw`a`;",
    "const sql = `SELECT ${cols.join(', ')} FROM t -- prepare(x).raw(1)`; db.prepare(sql).get();",
    "const read = db.prepare(sql);\nother.bind(read);",
    "if (a == prepare(sql)) x.bind(y);",
  ];
  for (const source of missed) assert.deepEqual(statementModeCalls(source), [], source);
  assert.deepEqual(statementModeCalls("const a = 1;\nconst read = db.prepare(\n  sql,\n);\n\nread.raw(1);"), [6], 'reported at its line');
});

test('rule 48 — the application database is cached, and no module of server/src or scripts/ sets a statement mode or iterates', () => {
  const db = require('../database');
  assert.equal(db.__statementCache, true);
  const SRC = path.join(__dirname, '..');
  const SCRIPTS = path.join(__dirname, '..', '..', '..', 'scripts');
  const ROOT = path.join(SCRIPTS, '..');
  const offenders = [];
  let scanned = 0;
  const walk = (dir, skip) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || skip.includes(entry.name)) return;
      walk(full, skip);
    } else if (/\.(c|m)?js$/.test(entry.name) && full !== path.join(SRC, 'utils', 'statementCache.js')) {
      scanned += 1;
      for (const line of statementModeCalls(fs.readFileSync(full, 'utf8'))) offenders.push(`${path.relative(ROOT, full)}:${line}`);
    }
  });
  walk(SRC, ['tests', 'apps']);
  const fromSrc = scanned;
  if (fs.existsSync(SCRIPTS)) walk(SCRIPTS, []);
  assert.ok(fromSrc > 200, `only ${fromSrc} files of server/src read`);
  assert.ok(!fs.existsSync(SCRIPTS) || scanned > fromSrc, 'scripts/ was not read');
  assert.deepEqual(offenders, []);
});
