#!/usr/bin/env node
/**
 * A test line added by a PR carries no literal date the calendar will pass (specs/server-test-isolation.md
 * rule 7).
 *
 *   node scripts/check-test-dates.mjs --base origin/inte/plugins       # every PR: names the lines it adds,
 *                                                                      # as warnings (exit 0)
 *   node scripts/check-test-dates.mjs --base origin/inte/plugins --strict
 *                                                                      # the same, exit 1 when one is named
 *   node scripts/check-test-dates.mjs --base <ref> --head <ref> --today YYYY-MM-DD
 *                                                                      # replay a past diff on its own day
 *
 * A literal date written in a test today is a time bomb once the calendar passes it: a stay « in the
 * future » becomes a stay in the past, an acompte window closes, a journal month changes year. Audit R7
 * found 19 of them, and the very next PR (#893) brought 4 back. Only the lines a PR ADDS are read, so the
 * existing suites block nobody, and only dates from today to ten years out are named: a date already in
 * the past cannot be passed again, and one further out (`2099-06-01`) is a deliberate far future.
 *
 * On CI the step only warns (an annotation on the line, a list in the job summary): replayed on the 40
 * PRs merged into inte/plugins before 2026-10-30, it named lines in about half of them, many of them
 * dates a test hands to the code as its « now ». `--strict` fails instead.
 *
 * Read: on a line that is not a comment, a quoted `YYYY-MM-DD` (alone or as the start of a timestamp), and `Date.UTC(YYYY, …)` /
 * `new Date(YYYY, …)` from the current year on. Test files are the `.js/.jsx/.mjs/.cjs/.ts/.tsx` files of
 * a `tests/`, `__tests__/` or `e2e/` folder, and every `*.test.*` / `*.spec.*` file.
 *
 * Not named:
 *   - a line carrying `date-literal-ok`, or whose previous line does: the date is an input of a pure
 *     function, or a value nothing compares with today. Say why after the marker;
 *   - every line of a file that pins the clock (`vi.setSystemTime(`, `mock.timers.enable(`,
 *     `mock.timers.setTime(`): the test decides what today is.
 *
 * The decision is a pure function, exported for the unit suite.
 */
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = 'date-literal-ok';

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });

/** Whether `file` is a test source this check reads. */
export function isTestFile(file) {
  if (!/\.(c|m)?[jt]sx?$/.test(file)) return false;
  if (/(^|\/)node_modules\//.test(file)) return false;
  return /(^|\/)(tests|__tests__|e2e)\//.test(file) || /\.(test|spec)\.(c|m)?[jt]sx?$/.test(file);
}

/** Whether the file decides what today is. */
export const pinsTheClock = (content) => /\bsetSystemTime\s*\(|\bmock\.timers\.(enable|setTime)\s*\(/.test(content);

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
    if (!isTestFile(file) || pinsTheClock(content)) continue;
    const lines = content.split('\n');
    for (const { line, text } of added) {
      if (text.includes(MARKER) || (lines[line - 2] || '').includes(MARKER)) continue;
      for (const { literal } of futureDates(text, today)) out.push({ file, line, literal });
    }
  }
  return out;
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
    console.error('Usage: node scripts/check-test-dates.mjs --base <ref> [--head <ref>] [--today YYYY-MM-DD]');
    process.exit(2);
  }
  const mergeBase = git(['merge-base', base, head]).trim();
  const diff = git(['diff', '--unified=0', '--no-renames', '--diff-filter=AM', mergeBase, head]);
  const files = parseAddedLines(diff)
    .filter((f) => isTestFile(f.file))
    .map((f) => ({ ...f, content: git(['show', `${head}:${f.file}`]) }));
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
