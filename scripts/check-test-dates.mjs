#!/usr/bin/env node
/**
 * A test line added by a PR carries no literal date the calendar will pass (specs/server-test-isolation.md
 * rule 7).
 *
 *   node scripts/check-test-dates.mjs --base origin/inte/plugins --known origin/master,origin/inte/plugins --strict
 *                                                                      # every PR on CI: names the lines it
 *                                                                      # adds, exit 1 when one is named
 *   node scripts/check-test-dates.mjs --base origin/inte/plugins       # the same list, as warnings (exit 0)
 *   node scripts/check-test-dates.mjs --base <ref> --head <ref> --today YYYY-MM-DD
 *                                                                      # replay a past diff on its own day
 *
 * A literal date written in a test today is a time bomb once the calendar passes it: a stay « in the
 * future » becomes a stay in the past, an acompte window closes, a journal month changes year. Audit R7
 * found 19 of them, and the very next PR (#893) brought 4 back. Only the lines a PR ADDS are read, so the
 * existing suites block nobody, and only dates from today to ten years out are named: a date already in
 * the past cannot be passed again, and one further out (`2099-06-01`) is a deliberate far future.
 *
 * On CI the step runs `--strict` and blocks the PR (decided 2026-10-30): a warning reaches nobody, since
 * PRs are merged on their check buckets, and #893 would have merged with its 13 named lines. Replayed on
 * the 40 PRs merged into inte/plugins before 2026-10-30, it named lines in about half of them, many of them
 * dates a test hands to the code as its « now »: those take the marker below, one comment each.
 *
 * Read: on a line that is not a comment, a quoted `YYYY-MM-DD` or iCal `YYYYMMDD` (alone or as the start of a timestamp), a template
 * opening on a year (`` `2028-${m}-10` ``), and `Date.UTC(YYYY, …)` / `new Date(YYYY, …)` from the current year on. Test files are the `.js/.jsx/.mjs/.cjs/.ts/.tsx` files of
 * a `tests/`, `__tests__/` or `e2e/` folder, and every `*.test.*` / `*.spec.*` file.
 *
 * Not named:
 *   - a line carrying `date-literal-ok`, or whose previous line does: the date is an input of a pure
 *     function, or a value nothing compares with today. Say why after the marker;
 *   - a line of a test that pins the clock (`vi.setSystemTime(`, `mock.timers.setTime(`, `vi.useFakeTimers({ now })`
 *     with `'Date'` in its `toFake` or no `toFake`, `mock.timers.enable(` with `'Date'` in its `apis` or no `apis`)
 *     or injects its own (a replaced `getTodayIsoDate` / `todayIso`, a `NOW` constant, a `now:` handed to the
 *     code, the real clock aside): that test decides what today is. A pin inside a `test` / `it` / `describe`
 *     (a `test.each` callback included) covers that block only; a pin in a named helper (an object or class
 *     method included) covers the helper and
 *     the blocks that call it; a pin outside all of them (top level, a top-level hook) covers the file.
 *
 * `--known <ref>,<ref>` sets aside an added line whose file already holds the same text on one of those refs, as
 * many times as the head file does (rule 9): the inte/plugins → master integration PR and the master ↔ inte syncs carry thousands of lines that
 * were merged, and checked, on the other branch. A ref that does not resolve sets nothing aside, with a warning.
 *
 * The decision is a pure function, exported for the unit suite.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MARKER = 'date-literal-ok';

/** `git <args>`: its output as text, or as a Buffer when `input` is fed to it. */
const git = (args, input) => execFileSync('git', args, {
  ...(input === undefined ? { encoding: 'utf8' } : { input: Buffer.from(input) }), stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024,
});

/** Whether `file` is a test source this check reads. */
export function isTestFile(file) {
  if (!/\.(c|m)?[jt]sx?$/.test(file)) return false;
  if (/(^|\/)node_modules\//.test(file)) return false;
  return /(^|\/)(tests|__tests__|e2e)\//.test(file) || /\.(test|spec)\.(c|m)?[jt]sx?$/.test(file);
}

const REGEX_BEFORE = new Set('(,=:[!&|?{};+-*%~^'.split(''));

/**
 * `content` with the inside of every string, template, regex literal and comment blanked to spaces, the
 * newlines kept: offsets and line numbers still match, and a `(` or a call written in a string is not code.
 */
export function codeOnly(content) {
  const out = content.split('');
  const blank = (from, to) => { for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' '; };
  let prev = '';
  let i = 0;
  while (i < content.length) {
    const c = content[i];
    const n = content[i + 1];
    if (c === '/' && n === '/') {
      const end = content.indexOf('\n', i);
      const stop = end < 0 ? content.length : end;
      blank(i, stop); i = stop; continue;
    }
    if (c === '/' && n === '*') {
      const end = content.indexOf('*/', i + 2);
      const stop = end < 0 ? content.length : end + 2;
      blank(i, stop); i = stop; continue;
    }
    if (c === '"' || c === "'" || c === '`' || (c === '/' && (prev === '' || REGEX_BEFORE.has(prev)))) {
      let j = i + 1;
      let inClass = false;
      while (j < content.length) {
        const d = content[j];
        if (d === '\\') { j += 2; continue; }
        if (c === '/' && d === '[') inClass = true;
        else if (c === '/' && d === ']') inClass = false;
        else if (d === c && !inClass) break;
        else if (d === '\n' && c !== '`') break;
        j += 1;
      }
      blank(i + 1, j); i = j + 1; prev = c; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return out.join('');
}

/** Offset of the bracket closing the one at `open` (`(` or `{`), in code blanked by `codeOnly`. */
function closing(code, open) {
  const [o, c] = code[open] === '{' ? ['{', '}'] : ['(', ')'];
  let depth = 0;
  for (let k = open; k < code.length; k += 1) {
    if (code[k] === o) depth += 1;
    else if (code[k] === c) { depth -= 1; if (depth === 0) return k; }
  }
  return code.length - 1;
}

const nextCode = (code, from) => { let k = from; while (k < code.length && /\s/.test(code[k])) k += 1; return k; };

const lineAt = (content, offset) => content.slice(0, offset).split('\n').length;

/**
 * The `test` / `it` / `describe` / `suite` calls, as `{ start, end }` offsets. `test.each([...])('…', fn)` and
 * `` test.each`…`('…', fn) `` run to the end of the call that holds the callback; `test.beforeEach(…)` and the
 * other hooks are not blocks (a hook outside every block covers the file).
 */
function testBlocks(code) {
  const blocks = [];
  for (const m of code.matchAll(/(^|[^.\w$])(test|it|describe|suite)((?:\.\w+)*)\s*([(`])/g)) {
    if (/\.(before|after)/i.test(m[3])) continue;
    let open = m.index + m[0].length - 1;
    if (code[open] === '`') {
      open = nextCode(code, code.indexOf('`', open + 1) + 1);
      if (code[open] !== '(') continue;
    }
    let end = closing(code, open);
    for (let k = nextCode(code, end + 1); code[k] === '('; k = nextCode(code, end + 1)) end = closing(code, k);
    blocks.push({ start: open, end });
  }
  return blocks;
}

const NOT_METHODS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'function']);

/**
 * The named functions — `function name(…) {…}`, `const name = (…) => …`, and the object or class methods
 * `name(…) {…}`, `name: (…) => {…}`, `name: function (…) {…}` — as `{ name, start, end, method }`.
 */
function namedFunctions(code) {
  const fns = [];
  for (const m of code.matchAll(/\bfunction\s+([\w$]+)\s*\(/g)) {
    const params = m.index + m[0].length - 1;
    const body = nextCode(code, closing(code, params) + 1);
    if (code[body] === '{') fns.push({ name: m[1], start: m.index, end: closing(code, body) });
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:\([^()]*\)|[\w$]+)\s*=>\s*/g)) {
    const body = m.index + m[0].length;
    const eol = code.indexOf('\n', body);
    fns.push({ name: m[1], start: m.index, end: code[body] === '{' ? closing(code, body) : (eol < 0 ? code.length : eol) });
  }
  for (const m of code.matchAll(/(?<![\w$.])([\w$]+)\s*(?:\([^()]*\)|:\s*(?:async\s*)?(?:function\s*[\w$]*\s*\([^()]*\)|(?:\([^()]*\)|[\w$]+)\s*=>))\s*\{/g)) {
    if (NOT_METHODS.has(m[1]) || /\bfunction\s*$/.test(code.slice(0, m.index))) continue;
    if (!/(?:^|[{,;]|\b(?:static|async|get|set))\s*$/.test(code.slice(Math.max(0, m.index - 40), m.index))) continue;
    const body = m.index + m[0].length - 1;
    fns.push({ name: m[1], start: m.index, end: closing(code, body), method: true });
  }
  return fns;
}

const REAL_NOW = /^(new Date\(\s*\)|Date\.now\(\s*\))/;

/**
 * → offsets where the clock is pinned. A pin is `vi.setSystemTime(`, `mock.timers.setTime(`,
 * `vi.useFakeTimers({ now })` whose `toFake` (when given) includes `'Date'`, `mock.timers.enable(` whose `apis`
 * include `'Date'` or are left out (the default mocks Date); or a clock the test injects: a replaced
 * `getTodayIsoDate` / `todayIso` (`helpers.getTodayIsoDate = () => …`, not a local `const todayIso = …`), a
 * `NOW` constant, or a `now:` handed to the code — unless it is the real clock (`new Date()`, `Date.now()`).
 */
function pinOffsets(content, code) {
  const out = [];
  const timerArgs = [];
  for (const m of code.matchAll(/\b(setSystemTime|mock\.timers\.setTime|mock\.timers\.enable|useFakeTimers)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = closing(code, open);
    timerArgs.push([open, close]);
    const args = content.slice(open + 1, close);
    if (m[1] === 'mock.timers.enable' && /\bapis\s*:/.test(args) && !/\bapis\s*:\s*\[[^\]]*(['"`])Date\1/.test(args)) continue;
    if (m[1] === 'useFakeTimers' && !/\bnow\s*[:,}]/.test(args)) continue;
    if (m[1] === 'useFakeTimers' && /\btoFake\s*:/.test(args) && !/\btoFake\s*:\s*\[[^\]]*(['"`])Date\1/.test(args)) continue;
    out.push(m.index);
  }
  const inTimer = (k) => timerArgs.some(([a, b]) => a < k && k < b);
  for (const m of code.matchAll(/(?<!\b(?:const|let|var)\s+)(?<![\w$])(getTodayIsoDate|todayIso)\s*=(?![=>])/g)) out.push(m.index);
  for (const m of code.matchAll(/\b(?:const|let|var)\s+NOW\s*=\s*/g)) {
    if (!REAL_NOW.test(code.slice(m.index + m[0].length))) out.push(m.index);
  }
  for (const m of code.matchAll(/[{,]\s*now\s*:\s*/g)) {
    if (!inTimer(m.index) && !REAL_NOW.test(code.slice(m.index + m[0].length))) out.push(m.index);
  }
  return out;
}

/**
 * → [{ from, to }] — the 1-based line ranges where the clock is pinned; `{ from: 1, to: Infinity }` when it is
 * pinned outside any `test` / `it` / `describe` block. Inside a block, the pin covers the innermost block that
 * holds it, and nothing else. Inside a named helper outside every block, it covers the helper and the blocks
 * that call it (and the whole file when a call sits outside every block, a top-level hook for one).
 */
export function pinnedRanges(content) {
  const code = codeOnly(content);
  const blocks = testBlocks(code);
  const fns = namedFunctions(code);
  const innermost = (list, k) => list.filter((b) => b.start < k && k < b.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  const ranges = [];
  const cover = (k, depth) => {
    const block = innermost(blocks, k);
    if (block) { ranges.push({ from: lineAt(content, block.start), to: lineAt(content, block.end) }); return; }
    const fn = innermost(fns, k);
    if (!fn) { ranges.push({ from: 1, to: Infinity }); return; }
    if (depth > 3) return;
    ranges.push({ from: lineAt(content, fn.start), to: lineAt(content, fn.end) });
    for (const call of code.matchAll(new RegExp(`(?<![\\w$${fn.method ? '' : '.'}])${fn.name.replace(/\$/g, '\\$')}\\s*\\(`, 'g'))) {
      if (call.index >= fn.start && call.index <= fn.end) continue;
      cover(call.index, depth + 1);
    }
  };
  for (const k of pinOffsets(content, code)) cover(k, 0);
  return ranges.some((r) => r.to === Infinity) ? [{ from: 1, to: Infinity }] : ranges;
}

const pad = (n) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of the local day. */
export const localToday = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

const HORIZON_YEARS = 10;

/** → [{ date, literal }] — the dates of `text` from `today` to ten years out. */
export function futureDates(text, today) {
  const trimmed = text.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return [];
  const year = Number(today.slice(0, 4));
  const horizon = `${year + HORIZON_YEARS}${today.slice(4)}`;
  const found = [];
  for (const m of text.matchAll(/(['"`])(20\d\d-[01]\d-[0-3]\d)(?=[T\s'"`])/g)) {
    if (m[2] >= today && m[2] <= horizon) found.push({ date: m[2], literal: m[2] });
  }
  for (const m of text.matchAll(/(['"`])(20\d\d)([01]\d)([0-3]\d)(?=T\d|['"`])/g)) {
    const date = `${m[2]}-${m[3]}-${m[4]}`;
    if (date >= today && date <= horizon) found.push({ date, literal: `${m[2]}${m[3]}${m[4]}` });
  }
  for (const m of text.matchAll(/`(20\d\d)-\$\{/g)) {
    const y = Number(m[1]);
    if (y >= year && y <= year + HORIZON_YEARS) found.push({ date: m[1], literal: `\`${m[1]}-\${…}\`` });
  }
  for (const m of text.matchAll(/\b(Date\.UTC|new Date)\(\s*(20\d\d)\s*,/g)) {
    const y = Number(m[2]);
    if (y >= year && y <= year + HORIZON_YEARS) found.push({ date: m[2], literal: `${m[1]}(${m[2]}, …)` });
  }
  return found;
}

/**
 * → [{ file, line, literal }] — the added lines that carry a date the calendar will pass.
 * `files`: [{ file, content, added: [{ line, text }] }], `content` being the file at the head.
 */
export function findDateBombs({ files, today }) {
  const out = [];
  for (const { file, content, added } of files) {
    if (!isTestFile(file)) continue;
    const pinned = pinnedRanges(content);
    const lines = content.split('\n');
    for (const { line, text } of added) {
      if (text.includes(MARKER) || (lines[line - 2] || '').includes(MARKER)) continue;
      if (pinned.some((r) => r.from <= line && line <= r.to)) continue;
      for (const { literal } of futureDates(text, today)) out.push({ file, line, literal });
    }
  }
  return out;
}

const countLines = (content) => {
  const counts = new Map();
  for (const l of content.split('\n')) counts.set(l.trim(), (counts.get(l.trim()) || 0) + 1);
  return counts;
};

/**
 * `files` without the added lines whose file already holds the same text (spaces around it aside) on a known
 * branch, as many times as the head file does: those lines were merged and checked there, and an integration
 * or sync PR only carries them over (specs/server-test-isolation.md rule 9). A line the head file holds more
 * often than every known ref is a new copy, and every added copy of it is read. `known(file)` → the file's
 * contents on the known branches; `content` is the file at the head.
 */
export function dropKnownLines(files, known) {
  return files.map((f) => {
    const onKnown = known(f.file).map(countLines);
    const onHead = countLines(f.content);
    const covered = (text) => {
      const t = text.trim();
      const most = Math.max(0, ...onKnown.map((c) => c.get(t) || 0));
      return most > 0 && (onHead.get(t) || 0) <= most;
    };
    return { ...f, added: f.added.filter(({ text }) => !covered(text)) };
  });
}

/** → Map(file → [content on each ref that has it]), read in one `git cat-file --batch`. */
function contentsOn(refs, files) {
  const keys = refs.flatMap((ref) => files.map((file) => ({ ref, file })));
  const map = new Map(files.map((file) => [file, []]));
  if (keys.length === 0) return map;
  const out = git(['cat-file', '--batch'], `${keys.map(({ ref, file }) => `${ref}:${file}`).join('\n')}\n`);
  let at = 0;
  for (const { file } of keys) {
    const eol = out.indexOf(10, at);
    const header = out.subarray(at, eol).toString('utf8');
    at = eol + 1;
    const size = header.match(/ blob (\d+)$/);
    if (!size) continue;
    map.get(file).push(out.subarray(at, at + Number(size[1])).toString('utf8'));
    at += Number(size[1]) + 1;
  }
  return map;
}

/** → [{ file, added: [{ line, text }] }] from a `git diff --unified=0` output. */
export function parseAddedLines(diff) {
  const files = [];
  let current = null;
  let next = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const name = raw.slice(4);
      current = name === '/dev/null' ? null : { file: name.replace(/^b\//, ''), added: [] };
      if (current) files.push(current);
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { next = Number(hunk[1]); continue; }
    if (!current || raw.startsWith('--- ')) continue;
    if (raw.startsWith('+')) { current.added.push({ line: next, text: raw.slice(1) }); next += 1; }
    else if (raw.startsWith(' ')) next += 1;
  }
  return files.filter((f) => f.added.length > 0);
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const base = opt('--base');
  const head = opt('--head') || 'HEAD';
  const today = opt('--today') || localToday();
  const strict = args.includes('--strict');
  if (!base) {
    console.error('Usage: node scripts/check-test-dates.mjs --base <ref> [--head <ref>] [--known <ref>,<ref>] [--today YYYY-MM-DD] [--strict]');
    process.exit(2);
  }
  const known = (opt('--known') || '').split(',').filter(Boolean).filter((ref) => {
    try { git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); return true; } catch {
      console.error(`⚠ --known ${ref} does not resolve: its lines are not set aside.`);
      return false;
    }
  });
  const mergeBase = git(['merge-base', base, head]).trim();
  const diff = git(['diff', '--unified=0', '--no-renames', '--diff-filter=AM', mergeBase, head]);
  const added = parseAddedLines(diff).filter((f) => isTestFile(f.file));
  const onHead = contentsOn([head], added.map((f) => f.file));
  const onKnown = contentsOn(known, added.map((f) => f.file));
  const files = dropKnownLines(added.map((f) => ({ ...f, content: onHead.get(f.file)[0] })), (file) => onKnown.get(file))
    .filter((f) => f.added.length > 0);
  const bombs = findDateBombs({ files, today });
  if (bombs.length === 0) {
    console.log(`✓ No literal date from ${today} on in the test lines added since ${base}.`);
    return;
  }
  const hint = 'Build the date from today (todayIso() + addDaysToIsoDate(), or `new Date()` arithmetic), pin the clock '
    + `in that file (vi.setSystemTime, mock.timers), or mark a date nothing compares with today with a « // ${MARKER}: `
    + '<why> » comment on the line or the line above. specs/server-test-isolation.md rule 7.';
  console.error(`${strict ? '✗' : '⚠'} ${bombs.length} literal date(s) in added test lines will be passed by the calendar:`);
  for (const b of bombs) console.error(`  ${b.file}:${b.line}  ${b.literal}`);
  console.error(`\n${hint}`);
  if (process.env.GITHUB_ACTIONS) {
    for (const b of bombs) console.log(`::warning file=${b.file},line=${b.line},title=Literal date in a test::${b.literal} will be passed by the calendar. ${hint}`);
  }
  if (strict) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
