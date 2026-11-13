/**
 * The per-commit « moved verbatim » proof (specs/pricing-components.md §3 rules 33 and 35): in a diff, every line a
 * source file loses must reappear, byte for byte but for its leading indentation, among the lines the diff adds
 * (in the same file or another). A moved function passes; a function that was edited while moving — a rename, a
 * rounding, a reordered operand — leaves its changed lines unmatched.
 *
 * Pure over the text of `git diff -U0`. Matching is a multiset: a removed line is matched by one added line, once — by
 * an added line of the same file first, then by one of any other file. The only lines allowed to be removed without a
 * twin are blank lines and the glue of moving code between modules, `GLUE` below — kept small and reviewed: imports,
 * export lists, `module.exports`, a bare `name,` or `key: name,` entry (a call such as `key: round(x),` is NOT glue).
 *
 * The proof also reports the other direction, for information: the non-glue lines a diff ADDS that no removed line
 * accounts for (`addedUnmatched`) — new code, or a moved line that changed on the way. It never fails the proof.
 */

// A line that is wiring, not logic: it carries no formula.
const GLUE = Object.freeze([
  /^$/, // blank
  /^(['"])use strict\1;?$/,
  /\brequire\(/, // const { a } = require('./x') and } = require('./x')
  /^(module\.)?exports\b/, // module.exports = { ..., exports.x = ...
  /^(import|export)\b.*\bfrom\b/, // ES re-exports and imports
  /^[A-Za-z_$][\w$]*(\s*:\s*[A-Za-z_$][\w$.]*)?,?$/, // one entry of an import or export list: `name,` or `key: name,`
]);

const isGlue = (text) => GLUE.some((pattern) => pattern.test(text));
const isTestPath = (file) => /(^|\/)(tests?|__tests__|e2e|fixtures)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
const isSourcePath = (file) => /\.(c|m)?jsx?$/.test(file) && /(^|\/)(server|client)\/src\//.test(file) && !isTestPath(file);

function parseDiff(diffText) {
  const removed = [];
  const added = [];
  let file = null;
  let oldFile = null;
  let oldLine = 0;
  for (const raw of String(diffText).split('\n')) {
    if (raw.startsWith('--- ')) { oldFile = raw.slice(4).replace(/^a\//, ''); continue; }
    if (raw.startsWith('+++ ')) { file = raw.slice(4) === '/dev/null' ? oldFile : raw.slice(4).replace(/^b\//, ''); continue; }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(raw);
    if (hunk) { oldLine = Number(hunk[1]); continue; }
    if (!file) continue;
    if (raw.startsWith('-')) { removed.push({ file, line: oldLine, text: raw.slice(1) }); oldLine += 1; }
    else if (raw.startsWith('+')) added.push({ file, text: raw.slice(1) });
  }
  return { removed, added };
}

const bare = (text) => text.replace(/^\s+/, '');

/**
 * @param {string} diffText output of `git diff -U0 --no-color --no-renames base..HEAD`
 * @returns {{ removed: number, matched: number, glue: number, unmatched: {file:string,line:number,text:string}[],
 *             addedUnmatched: {file:string,text:string}[] }}
 */
function moveProof(diffText, { isSource = isSourcePath } = {}) {
  const { removed, added } = parseDiff(diffText);
  const pool = added.filter(({ file }) => isSource(file)).map((item) => ({ ...item, key: bare(item.text), used: false }));
  const byKey = new Map();
  for (const item of pool) {
    if (!byKey.has(item.key)) byKey.set(item.key, []);
    byKey.get(item.key).push(item);
  }
  const take = (file, key) => {
    const candidates = (byKey.get(key) || []).filter((item) => !item.used);
    const found = candidates.find((item) => item.file === file) || candidates[0];
    if (found) found.used = true;
    return Boolean(found);
  };
  const result = { removed: 0, matched: 0, glue: 0, unmatched: [], addedUnmatched: [] };
  for (const item of removed) {
    if (!isSource(item.file)) continue;
    result.removed += 1;
    const key = bare(item.text);
    if (take(item.file, key)) result.matched += 1;
    else if (isGlue(key)) result.glue += 1;
    else result.unmatched.push(item);
  }
  result.addedUnmatched = pool.filter((item) => !item.used && !isGlue(item.key)).map(({ file, text }) => ({ file, text }));
  return result;
}

module.exports = { moveProof, parseDiff, isGlue, isSourcePath, GLUE };
