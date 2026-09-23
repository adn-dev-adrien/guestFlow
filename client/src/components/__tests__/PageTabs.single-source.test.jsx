// specs/ds-tabs.md rule 1 — PageTabs is the ONLY place that draws tabs. This guard is the rule
// itself: it fails the day a page reaches for `<Tabs>`/`<Tab>` again, which is exactly how the four
// divergent renderings appeared in the first place.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALLOWED = ['components/PageTabs.jsx'];

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // Test files may render a raw <Tabs> on purpose (PageTabs.styling proves the theme defaults).
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') sourceFiles(full, out);
    } else if (/\.jsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test('rule 1 — no page or component draws its own <Tabs>/<Tab>', () => {
  const offenders = sourceFiles(SRC)
    .filter((file) => !ALLOWED.includes(path.relative(SRC, file)))
    .filter((file) => /<Tabs[\s/>]|<Tab[\s/>]/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SRC, file));

  expect(offenders).toEqual([]);
});
