// specs/e2e-playwright-smoke-suite.md rule 21 — the server log is an artifact: every playwright config
// writes the webServer output to a file, and each e2e.yml job uploads it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// The files listed in the `path:` block of every `actions/upload-artifact` step; comments are ignored.
function uploadedPaths(workflow) {
  const lines = workflow.split('\n');
  const uploaded = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*(-\s+)?uses:\s*actions\/upload-artifact@/.test(lines[i])) continue;
    const stepIndent = lines[i].match(/^\s*/)[0].length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const indent = lines[j].match(/^\s*/)[0].length;
      if (lines[j].trim() && indent < stepIndent) break;
      if (/^\s*-\s/.test(lines[j]) && indent <= stepIndent) break;
      if (!/^\s*path:\s*\|?\s*$/.test(lines[j])) continue;
      const pathIndent = indent;
      for (let k = j + 1; k < lines.length; k += 1) {
        const kIndent = lines[k].match(/^\s*/)[0].length;
        if (lines[k].trim() && kIndent <= pathIndent) break;
        const entry = lines[k].trim();
        if (entry && !entry.startsWith('#')) uploaded.push(entry);
      }
      break;
    }
  }
  return uploaded;
}

test('rule 21: the main, bare and production-build configs write the server log to a file', () => {
  assert.match(read('playwright.config.js'), /node src\/index\.js > "\$\{SERVER_LOG\}" 2>&1/);
  assert.match(read('playwright.config.js'), /GUESTFLOW_E2E_SERVER_LOG \|\| path\.join\(__dirname, 'playwright-server\.log'\)/);
  assert.match(read('playwright.bare.config.js'), /GUESTFLOW_E2E_SERVER_LOG = .*playwright-server-bare\.log/);
  assert.match(read('playwright.prod.config.js'), /node e2e\/prod\/serve\.js > "\$\{SERVER_LOG\}" 2>&1/);
  assert.match(read('playwright.prod.config.js'), /playwright-server-prod\.log/);
});

test('rule 21: e2e.yml uploads the three server logs in the path of an upload-artifact step', () => {
  const uploaded = uploadedPaths(read('.github/workflows/e2e.yml'));
  for (const log of ['playwright-server.log', 'playwright-server-bare.log', 'playwright-server-prod.log']) {
    assert.ok(uploaded.includes(log), `${log} is not in the path of an upload-artifact step`);
  }
});

test('rule 21: a log named only in a comment, or outside an upload step, is not counted as uploaded', () => {
  const workflow = [
    'jobs:',
    '  e2e:',
    '    steps:',
    '      # playwright-server.log is uploaded below',
    '      - name: Upload',
    '        uses: actions/upload-artifact@abc # v7',
    '        with:',
    '          name: report',
    '          path: |',
    '            playwright-report/',
    '            # playwright-server.log',
    '      - name: Other',
    '        run: cat playwright-server-bare.log',
    '      - name: Next',
    '        uses: actions/upload-artifact@abc # v7',
    '        with:',
    '          path: |',
    '            playwright-server-prod.log',
  ].join('\n');
  assert.deepEqual(uploadedPaths(workflow), ['playwright-report/', 'playwright-server-prod.log']);
});
