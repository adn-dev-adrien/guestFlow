// specs/pricing-components.md §3 rule 66 — the pure part of the no-duplicate-formulas guards: what a hit is, how hits are
// counted and how they are judged against an allow-list. It reads no file, so the guards can be proved on synthetic
// sources (planted copies) as well as run on the real tree.
//
// A hit is one line of one file, comments stripped, trimmed. The allow-list is a multiset: `{ file, text, count?,
// removedBy, reason }`, `count` defaulting to 1 — a second identical copy in a listed file is an unlisted copy.

const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

function hitsOfSource(source, patterns) {
  const hits = [];
  stripComments(source).split('\n').forEach((line, index) => {
    if (patterns.some((pattern) => pattern.test(line))) hits.push({ text: line.trim(), line: index + 1 });
  });
  return hits;
}

// `files` is `{ relativePath: source }`.
function hitsOfFiles(files, guard) {
  const out = [];
  for (const [file, source] of Object.entries(files)) {
    if (guard.isHome(file) || (guard.scope && !guard.scope(file))) continue;
    for (const hit of hitsOfSource(source, guard.patterns)) if (!(guard.skip && guard.skip(file, hit.text))) out.push({ file, text: hit.text, line: hit.line });
  }
  return out;
}

const keyOf = ({ file, text }) => `${file} :: ${text}`;

function tally(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(keyOf(entry), (counts.get(keyOf(entry)) || 0) + (entry.count || 1));
  return counts;
}

// Returns the copies not in the list (with how many too many) and the listed ones that are gone (or fewer than listed).
function judge(hits, allowed) {
  const found = tally(hits);
  const listed = tally(allowed);
  const unlisted = [];
  const stale = [];
  for (const [key, count] of found) if (count > (listed.get(key) || 0)) unlisted.push(`${key}${count - (listed.get(key) || 0) > 1 ? ` (x${count - (listed.get(key) || 0)})` : ''}`);
  for (const [key, count] of listed) if ((found.get(key) || 0) < count) stale.push(key);
  return { unlisted, stale };
}

// The allow-list that describes `hits` exactly: one entry per distinct line, `count` when it repeats. `previous` keeps the
// removedBy/reason already written for a line; `describe(file, text)` gives them to a line seen for the first time.
function entriesOf(hits, previous, describe) {
  const known = new Map(previous.map((entry) => [keyOf(entry), entry]));
  const counts = tally(hits);
  const seen = new Set();
  const out = [];
  for (const hit of hits) {
    const key = keyOf(hit);
    if (seen.has(key)) continue;
    seen.add(key);
    const old = known.get(key);
    const fresh = describe(hit.file, hit.text, old && old.removedBy);
    const removedBy = (old && old.removedBy) || fresh.removedBy;
    const reason = (old && old.reason) || fresh.reason;
    const entry = { file: hit.file, text: hit.text };
    if (counts.get(key) > 1) entry.count = counts.get(key);
    out.push({ ...entry, removedBy, reason });
  }
  return out;
}

module.exports = { stripComments, hitsOfSource, hitsOfFiles, keyOf, tally, judge, entriesOf };
