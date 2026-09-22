// specs/terms-acceptance-record.md §3.1 rules 2 and 4 — the CGV Markdown renderer: escape-first (no
// operator HTML ever reaches the site), the supported subset, the variables and the frozen hash.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  renderMarkdown, resolveVariables, renderVersion, buildTermsVariables, TERMS_VARIABLES,
} = require('../utils/termsRenderer');

test('raw HTML is escaped, never rendered — a script tag stays text', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('a link only renders for http(s) targets; javascript: stays literal text', () => {
  assert.equal(
    renderMarkdown('[CGV](https://domainesolio.com/cgv/)'),
    '<p><a href="https://domainesolio.com/cgv/" target="_blank" rel="noopener">CGV</a></p>',
  );
  const js = renderMarkdown('[clic](javascript:alert(1))');
  assert.ok(!js.includes('<a '));
});

test('a quote in a link text cannot break out of the attribute', () => {
  const html = renderMarkdown('[x](https://a.fr/" onclick="alert(1))');
  assert.ok(!html.includes('onclick="'));
});

test('headings, paragraphs, lists, bold and italic', () => {
  const html = renderMarkdown('## Titre\n\n### Article 1\nUne **caution** est *demandée*.\nSuite.\n\n- un\n- deux');
  assert.equal(html, [
    '<h2>Titre</h2>',
    '<h3>Article 1</h3>',
    '<p>Une <strong>caution</strong> est <em>demandée</em>.<br>Suite.</p>',
    '<ul><li>un</li><li>deux</li></ul>',
  ].join('\n'));
});

test('a single # is not a heading (the page title belongs to the site)', () => {
  assert.equal(renderMarkdown('# Titre'), '<p># Titre</p>');
});

test('variables: known ones are replaced, unknown ones are reported once and left in place', () => {
  const r = resolveVariables('{{siret}} {{ penalite }} {{penalite}}', { siret: '123' });
  assert.equal(r.text, '123 {{ penalite }} {{penalite}}');
  assert.deepEqual(r.unknown, ['penalite']);
});

test('buildTermsVariables — company fields and one caution line per property', () => {
  const vars = buildTermsVariables(
    { companyName: 'SAS Solio', companyAddress: 'Satillieu', companySiret: '1', companyEmail: 'a@b.fr', companyPhone: '06' },
    [{ name: 'La Granja', defaultCautionAmount: 500 }, { name: "L'Estiva", defaultCautionAmount: 312.5 }],
  );
  assert.deepEqual(Object.keys(vars), TERMS_VARIABLES);
  assert.equal(vars.raisonSociale, 'SAS Solio');
  assert.equal(vars.cautions, "- La Granja : 500 €\n- L'Estiva : 312,50 €");
});

test('{{cautions}} on its own line renders as a list', () => {
  const vars = buildTermsVariables({}, [{ name: 'A', defaultCautionAmount: 1 }, { name: 'B', defaultCautionAmount: 2 }]);
  const r = renderVersion({ fr: 'Caution :\n\n{{cautions}}', en: 'x' }, vars);
  assert.equal(r.htmlFr, '<p>Caution :</p>\n<ul><li>A : 1 €</li><li>B : 2 €</li></ul>');
});

test('renderVersion — hash depends on the rendered text of both languages', () => {
  const vars = buildTermsVariables({}, [{ name: 'A', defaultCautionAmount: 500 }]);
  const a = renderVersion({ fr: '{{cautions}}', en: 'Deposit' }, vars);
  const b = renderVersion({ fr: '{{cautions}}', en: 'Deposit' }, vars);
  const c = renderVersion({ fr: '{{cautions}}', en: 'Deposit' }, buildTermsVariables({}, [{ name: 'A', defaultCautionAmount: 600 }]));
  const d = renderVersion({ fr: '{{cautions}}', en: 'Deposit!' }, vars);
  assert.match(a.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(a.contentHash, b.contentHash);
  assert.notEqual(a.contentHash, c.contentHash);
  assert.notEqual(a.contentHash, d.contentHash);
  assert.deepEqual(a.unknown, []);
});
