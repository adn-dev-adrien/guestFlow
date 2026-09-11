// Enriched Qonto payment-link stay label (specs/qonto-payment-link-reference.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildStayLineLabel, guestName, truncate, frDate, nightsBetween } = require('../utils/paymentLinkLabel');

const G = { firstName: 'Claude', lastName: 'Dupont' };

test('nominal — Séjour <Bien> — <Réf> — <Prénom Nom> + full description (rules 1,2)', () => {
  const { title, description } = buildStayLineLabel({
    propertyName: 'La Granja', reference: '2026-09-002', guest: G,
    startDate: '2026-10-10', endDate: '2026-10-12', kind: 'full',
  });
  assert.equal(title, 'Séjour La Granja — 2026-09-002 — Claude Dupont');
  assert.equal(description, 'Séjour du 10/10/2026 au 12/10/2026 · 2 nuits · réf 2026-09-002');
});

test('name order is Prénom then Nom', () => {
  assert.equal(guestName(G), 'Claude Dupont');
});

test('deposit / balance note the type in the description (rule 4)', () => {
  assert.match(buildStayLineLabel({ propertyName: 'La Granja', reference: 'R1', guest: G, startDate: '2026-10-10', endDate: '2026-10-11', kind: 'deposit' }).description, /^Acompte · /);
  assert.match(buildStayLineLabel({ propertyName: 'La Granja', reference: 'R1', guest: G, startDate: '2026-10-10', endDate: '2026-10-11', kind: 'balance' }).description, /^Solde · /);
  assert.doesNotMatch(buildStayLineLabel({ propertyName: 'La Granja', reference: 'R1', guest: G, startDate: '2026-10-10', endDate: '2026-10-11', kind: 'full' }).description, /Acompte|Solde/);
});

test('one night → « 1 nuit » singular', () => {
  assert.match(buildStayLineLabel({ propertyName: 'X', reference: 'R', guest: G, startDate: '2026-10-10', endDate: '2026-10-11', kind: 'full' }).description, /· 1 nuit ·/);
});

test('missing reference → title drops the ref segment cleanly (rule 7)', () => {
  const { title, description } = buildStayLineLabel({ propertyName: 'La Granja', reference: '', guest: G, startDate: '2026-10-10', endDate: '2026-10-12', kind: 'full' });
  assert.equal(title, 'Séjour La Granja — Claude Dupont');
  assert.doesNotMatch(title, /—\s+—/);
  assert.doesNotMatch(description, /réf/); // no reference → no « réf … » segment
});

test('missing guest name → title drops the name segment (rule 7)', () => {
  assert.equal(
    buildStayLineLabel({ propertyName: 'La Granja', reference: '2026-09-002', guest: { firstName: '', lastName: '' }, startDate: '2026-10-10', endDate: '2026-10-12', kind: 'full' }).title,
    'Séjour La Granja — 2026-09-002',
  );
});

test('missing property → « Séjour » alone leads the title', () => {
  assert.equal(
    buildStayLineLabel({ propertyName: null, reference: 'R', guest: G, startDate: '2026-10-10', endDate: '2026-10-12', kind: 'full' }).title,
    'Séjour — R — Claude Dupont',
  );
});

test('no dates → description omits the stay/nights, keeps réf; never null/undefined', () => {
  const { title, description } = buildStayLineLabel({ propertyName: 'La Granja', reference: 'R7', guest: G, kind: 'full' });
  assert.equal(title, 'Séjour La Granja — R7 — Claude Dupont');
  assert.equal(description, 'réf R7');
});

test('everything missing → « Séjour » title, no description (no crash, rule 7)', () => {
  const { title, description } = buildStayLineLabel({});
  assert.equal(title, 'Séjour');
  assert.equal(description, undefined);
});

test('title truncated on a word boundary to ≤ 120 chars with … (rule 8)', () => {
  const longName = { firstName: 'Jean-Baptiste-Alexandre', lastName: 'de la Motte-Beuvron-sur-Loire-et-Cher-Montmorency-Laval' };
  const { title } = buildStayLineLabel({ propertyName: 'Le Grand Gîte du Domaine Solio en Ardèche verte', reference: '2026-09-002', guest: longName, startDate: '2026-10-10', endDate: '2026-10-12', kind: 'full' });
  assert.ok(title.length <= 120, `title too long: ${title.length}`);
  assert.ok(title.endsWith('…'));
  assert.doesNotMatch(title, /\s…$/); // trimmed before the ellipsis
});

test('helpers: frDate + nightsBetween', () => {
  assert.equal(frDate('2026-10-12'), '12/10/2026');
  assert.equal(frDate('bad'), null);
  assert.equal(nightsBetween('2026-10-10', '2026-10-12'), 2);
  assert.equal(nightsBetween('2026-10-12', '2026-10-10'), null); // non-positive span
  assert.equal(truncate('short', 120), 'short');
});
