/**
 * `node --test` reporter added by the server and control-plane `npm test` scripts —
 * specs/server-test-isolation.md rule 10. It fails the run when a test file's process ended before
 * reporting every test it declared, which the runner itself reports as a green, shorter run.
 *
 * Per file, every top-level test announced (`test:enqueue`, emitted when the file declares it) must be
 * reported (`test:pass`, skips and todos included, or `test:fail`). Names are matched, not counts: the
 * runner also enqueues one synthetic test per file, named after the file, which is only reported when
 * the child reported nothing at all — that case fails too.
 *
 * Audit R9 M-1: with `--test-force-exit`, CI reported 8 898 tests instead of 8 910 and stayed green, the
 * last 12 of `sas-commit.unit.test.js` never run.
 */
import path from 'node:path';

const isFileEntry = (data) => data.name === data.file || data.file.endsWith(path.sep + data.name);

export default async function* completeness(source) {
  const files = new Map();
  const fileOf = (file) => {
    if (!files.has(file)) files.set(file, { declared: new Map(), reported: new Map(), silent: false });
    return files.get(file);
  };
  const bump = (map, name) => map.set(name, (map.get(name) || 0) + 1);

  for await (const event of source) {
    const data = event.data || {};
    if (data.nesting !== 0 || !data.file) continue;
    if (event.type === 'test:enqueue') {
      if (!isFileEntry(data)) bump(fileOf(data.file).declared, data.name);
    } else if (event.type === 'test:pass' || event.type === 'test:fail') {
      if (isFileEntry(data)) fileOf(data.file).silent = event.type === 'test:pass';
      else bump(fileOf(data.file).reported, data.name);
    }
  }

  for (const [file, { declared, reported, silent }] of files) {
    const name = path.relative(process.cwd(), file);
    const missing = [];
    let total = 0;
    for (const [test, count] of declared) {
      total += count;
      for (let i = reported.get(test) || 0; i < count; i += 1) missing.push(test);
    }
    if (missing.length) {
      process.exitCode = 1;
      yield `✖ ${name}: ${missing.length} of ${total} tests never reported — the file's process ended before them:\n${missing.map((t) => `  - ${t}\n`).join('')}`;
    } else if (silent && total === 0) {
      process.exitCode = 1;
      yield `✖ ${name}: no test reported — the file's process ended before reporting any.\n`;
    }
  }
}
