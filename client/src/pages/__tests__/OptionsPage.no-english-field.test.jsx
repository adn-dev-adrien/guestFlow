import fs from 'node:fs';
import path from 'node:path';

// specs/translation-catalogue.md rule 19 — the screens stop asking for translations. That is half of
// what this change is for: the option and resource dialogs get shorter, and the one place to
// translate is the file.
//
// Read as source rather than rendered: the assertion is about a field being ABSENT, and the cheapest
// honest way to prove an absence across a 900-line page is to look at the page.

const SRC = path.join(__dirname, '..');

const read = (file) => fs.readFileSync(path.join(SRC, file), 'utf8');

test('the option dialog has no English title field (rule 19)', () => {
  const page = read('OptionsPage.jsx');
  expect(page).not.toMatch(/titleEn/);
  expect(page).not.toMatch(/EnglishTitleField/);
  expect(page).not.toMatch(/Titre \(anglais\)/);
});

test('the resource dialog has no English name field (rule 19)', () => {
  const page = read('ResourcesPage.jsx');
  expect(page).not.toMatch(/nameEn/);
  expect(page).not.toMatch(/Nom \(anglais\)/);
});

test('no screen anywhere still asks for a translation (rule 19)', () => {
  // The e-mail templates and the CGV keep their own editors on purpose (rule 2) — they are documents,
  // not labels — so they are the only places allowed to carry a second language.
  const allowed = new Set(['EmailTemplatesPage.jsx']);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(full); continue; }
      if (!entry.name.endsWith('.jsx')) continue;
      if (allowed.has(entry.name)) continue;
      if (/\b(titleEn|nameEn)\b/.test(fs.readFileSync(full, 'utf8'))) offenders.push(entry.name);
    }
  };
  walk(SRC);
  expect(offenders).toEqual([]);
});
