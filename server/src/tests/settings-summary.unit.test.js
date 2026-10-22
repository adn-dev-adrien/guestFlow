// specs/settings-rationalization.md rule 25 (UI/UX review 2026-10-18, proposal 20) — the summary
// page reads one line of state per Paramètres page, computed by the server; a warning tone marks
// what is missing; a line that cannot be computed is left out.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb } = require('./guestEmailSequenceFixtures');
const { buildSummary } = require('../controllers/settingsSummaryController');

function deps(db, over = {}) {
  return {
    db,
    settings: () => ({ companyName: 'Domaine Solio', companyIban: 'FR76…', vatRate: 10, fiscalYearEndMonth: 9, smtpHost: '', ...over.row }),
    platformAvailable: () => false,
    plugins: () => over.plugins || [],
    appVersion: () => '3.10.0',
    twoFactorEnabled: () => Boolean(over.twoFactor),
    today: () => '2026-10-19',
    ...over.deps,
  };
}

test('rule 25: counts and states of the core pages', () => {
  const db = freshDb();
  db.prepare("INSERT INTO properties (name) VALUES ('Gîte'), ('Lodge')").run();
  db.prepare("INSERT INTO establishment_closures (startDate, endDate) VALUES ('2026-12-01', '2026-12-31'), ('2025-01-01', '2025-01-31')").run();
  const { lines } = buildSummary(deps(db), { id: 1 });
  assert.deepEqual(lines['/settings/etablissement'], { text: 'Domaine Solio', tone: 'neutral' });
  assert.deepEqual(lines['/properties'], { text: '2 logements', tone: 'neutral' });
  assert.deepEqual(lines['/parametres/vacances-fermetures'], { text: '1 fermeture à venir', tone: 'neutral' });
  assert.deepEqual(lines['/settings/tva-exercice'], { text: 'TVA 10 % · exercice clos fin septembre', tone: 'neutral' });
  assert.deepEqual(lines['/settings/emails'], { text: 'Envoi non configuré', tone: 'warning' });
  assert.deepEqual(lines['/settings/systeme'], { text: 'Version 3.10.0', tone: 'neutral' });
  assert.deepEqual(lines['/mon-compte'], { text: 'Second code non activé', tone: 'neutral' });
  assert.equal(lines['/settings/integrations'], undefined, 'nothing to configure: no line');
  db.close();
});

test('rule 25: what is missing reads as a warning', () => {
  const db = freshDb();
  const { lines } = buildSummary(deps(db, { row: { companyIban: '' } }), null);
  assert.deepEqual(lines['/settings/etablissement'], { text: 'Domaine Solio · IBAN à saisir', tone: 'warning' });
  assert.deepEqual(lines['/properties'], { text: 'Aucun logement', tone: 'warning' });
  db.close();
});

test('rule 25: the sender line follows the platform, the own server, or its absence', () => {
  const db = freshDb();
  assert.equal(buildSummary(deps(db, { deps: { platformAvailable: () => true } }), null).lines['/settings/emails'].text, 'Envoi par la plateforme');
  const own = buildSummary(deps(db, { row: { smtpHost: 'ssl0.ovh.net', smtpPasswordSet: true, companyEmail: 'a@gite.fr' } }), null);
  assert.deepEqual(own.lines['/settings/emails'], { text: 'Envoi par ssl0.ovh.net', tone: 'neutral' });
  const half = buildSummary(deps(db, { row: { smtpHost: 'ssl0.ovh.net', smtpPasswordSet: false, companyEmail: 'a@gite.fr' } }), null);
  assert.deepEqual(half.lines['/settings/emails'], { text: 'Envoi incomplet', tone: 'warning' });
  db.close();
});

test('rule 25: plugins to configure show on Plugins, Intégrations and their own page', () => {
  const db = freshDb();
  const plugins = [
    { id: 'neat', state: 'active', setup: { needed: true, path: '/settings/integrations?tab=neat' } },
    { id: 'online-payment', state: 'active', setup: { needed: true, path: '/parametres/paiements' } },
    { id: 'linen', state: 'active', setup: { needed: false, path: '/parametres/stock-blanchisserie' } },
    { id: 'sas', state: 'inactive', setup: { needed: false, path: null } },
  ];
  const { lines } = buildSummary(deps(db, { plugins }), null);
  assert.deepEqual(lines['/parametres/plugins'], { text: '3 actifs · 2 à configurer', tone: 'warning' });
  assert.deepEqual(lines['/settings/integrations'], { text: '1 à configurer', tone: 'warning' });
  assert.deepEqual(lines['/parametres/paiements'], { text: 'À configurer', tone: 'warning' });
  assert.equal(lines['/parametres/stock-blanchisserie'], undefined);
  db.close();
});

test('rule 25: a line that fails is left out, the others stay', () => {
  const db = freshDb();
  db.exec('DROP TABLE terms_versions');
  const { lines } = buildSummary(deps(db, { twoFactor: true }), { id: 4 });
  assert.equal(lines['/parametres/conditions-generales'], undefined);
  assert.equal(lines['/mon-compte'].text, 'Second code activé');
  assert.ok(lines['/properties']);
  db.close();
});
