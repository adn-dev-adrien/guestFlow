// specs/pricing-components.md §3 rule 47 — the head `utils/pricing/articles/index.js` is the only module of `articles/` that
// code outside the folder requires. A require is resolved to an absolute path (a relative path written from inside
// `utils/pricing` or from a plugin resolves like any other), so no spelling of it slips past the check.
const path = require('node:path');

const requiresOf = (source) => [...source.matchAll(/require\(\s*(['"`])(.+?)\1\s*\)/g)].map((m) => m[2]);

// `files` is `{ absolutePath: source }`; `articlesDir` the absolute `utils/pricing/articles`.
function offendersOf(files, articlesDir) {
  const out = [];
  const inside = (file) => file === articlesDir || file.startsWith(`${articlesDir}${path.sep}`);
  for (const [file, source] of Object.entries(files)) {
    if (inside(file)) continue;
    for (const spec of requiresOf(source)) {
      if (!spec.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), spec).replace(/\.js$/, '');
      if (!inside(target)) continue;
      if (target === articlesDir || target === path.join(articlesDir, 'index')) continue;
      out.push(`${file} requires ${spec}`);
    }
  }
  return out;
}

module.exports = { offendersOf };
