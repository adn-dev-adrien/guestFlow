// Review amendments: rule 49 — several links start on a new line; a space refused; legacy input held to the host.
// specs/settings-input-guards.md rules 35-44 — the ordered social links of the guest e-mails.
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-input-guards-social-')), 'c.db');

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const silent = console.log;
console.log = () => {};
const db = require('../database');
const settingsController = require('../controllers/settingsController');
console.log = silent;
const { shapeResponse } = require('../utils/settingsResponse');
const {
  SOCIAL_NETWORKS, validateSocialLinks, instagramUrlOf, mergeLegacyInstagram, renderSocialLinks, publicNetworks,
} = require('../utils/socialLinks');
const { migrateSocialLinks } = require('../utils/socialLinksMigration');
const { DEFAULT_TEMPLATES } = require('../utils/defaultEmailTemplatesRegistry');
const { MAIL } = require('../utils/guestEmailSequence');
const { buildContext } = require('../utils/emailContextBuilder');
const { renderTemplate } = require('../utils/emailTemplateRenderer');

const IG = 'https://www.instagram.com/exemple';
const FB = 'https://www.facebook.com/exemple';

const stored = () => db.prepare('SELECT socialLinks, instagramUrl FROM app_settings WHERE id = 1').get();
const storedList = () => JSON.parse(stored().socialLinks);

async function put(emails) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await settingsController.updateSettings({ body: { emails }, params: {}, query: {} }, res);
  return res;
}

function minimalDb(instagramUrl, socialLinks) {
  const m = new Database(':memory:');
  m.exec(`CREATE TABLE migrations (name TEXT PRIMARY KEY, appliedAt TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, instagramUrl TEXT DEFAULT '', socialLinks TEXT NOT NULL DEFAULT '[]');`);
  m.prepare('INSERT INTO app_settings (id, instagramUrl, socialLinks) VALUES (1, ?, ?)').run(instagramUrl, socialLinks);
  return m;
}

test('rule 41: the Instagram URL is copied once into the list, verbatim', () => {
  const m = minimalDb(IG, '[]');
  assert.equal(migrateSocialLinks(m).action, 'copied');
  assert.deepEqual(JSON.parse(m.prepare('SELECT socialLinks FROM app_settings').get().socialLinks), [{ network: 'instagram', url: IG }]);
  assert.equal(m.prepare('SELECT instagramUrl FROM app_settings').get().instagramUrl, IG, 'rule 42: kept for rollback');
});

test('rule 41: an empty Instagram URL writes an empty list', () => {
  const m = minimalDb('', '[]');
  assert.equal(migrateSocialLinks(m).action, 'empty');
  assert.equal(m.prepare('SELECT socialLinks FROM app_settings').get().socialLinks, '[]');
});

test('rule 41: re-running is a no-op, an edited list is never overwritten', () => {
  const m = minimalDb(IG, '[]');
  migrateSocialLinks(m);
  m.prepare('UPDATE app_settings SET socialLinks = ?').run(JSON.stringify([{ network: 'facebook', url: FB }]));
  assert.equal(migrateSocialLinks(m).action, 'already-ran');
  assert.deepEqual(JSON.parse(m.prepare('SELECT socialLinks FROM app_settings').get().socialLinks), [{ network: 'facebook', url: FB }]);
});

test('rule 41: an old free value that fails the host check is still migrated, and flagged when the list is saved', () => {
  const odd = 'https://linktr.ee/exemple';
  const m = minimalDb(odd, '[]');
  migrateSocialLinks(m);
  const list = JSON.parse(m.prepare('SELECT socialLinks FROM app_settings').get().socialLinks);
  assert.deepEqual(list, [{ network: 'instagram', url: odd }]);
  assert.equal(validateSocialLinks(list).errors['socialLinks.0.url'], 'Lien d\'un autre réseau.');
});

test('rule 41: a schema without the column is skipped', () => {
  const m = new Database(':memory:');
  m.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY); CREATE TABLE app_settings (id INTEGER PRIMARY KEY, instagramUrl TEXT)');
  assert.equal(migrateSocialLinks(m).action, 'skipped-schema');
});

test('rule 36: the catalogue is sent with the settings, hosts stay server-side', () => {
  assert.deepEqual(SOCIAL_NETWORKS.map((n) => n.value), ['instagram', 'facebook', 'tiktok', 'youtube', 'pinterest', 'linkedin', 'x']);
  assert.deepEqual(publicNetworks()[0], { value: 'instagram', label: 'Instagram' });
  const body = shapeResponse({ instagramUrl: IG, socialLinks: '[]' });
  assert.deepEqual(body.emails.socialNetworks, publicNetworks());
  assert.deepEqual(body.emails.socialLinks, [{ network: 'instagram', url: IG }], 'a list never written falls back to the legacy URL');
});

test('rule 36: any subdomain of an accepted host matches, a look-alike does not', () => {
  const ok = [['instagram', 'https://instagram.com/a'], ['instagram', 'https://m.instagram.com/a?igsh=zz'], ['facebook', 'https://fb.me/x'],
    ['youtube', 'https://youtu.be/abc'], ['pinterest', 'https://pin.it/abc'], ['x', 'https://twitter.com/a'], ['tiktok', 'https://www.tiktok.com/@a'],
    ['linkedin', 'https://fr.linkedin.com/in/a']];
  for (const [network, url] of ok) assert.deepEqual(validateSocialLinks([{ network, url }]).errors, {}, url);
  for (const url of ['https://notinstagram.com/a', 'https://instagram.com.evil.fr/a', 'https://evil.fr/instagram.com']) {
    assert.equal(validateSocialLinks([{ network: 'instagram', url }]).errors['socialLinks.0.url'], 'Lien d\'un autre réseau.', url);
  }
});

test('rule 37: each refusal has its message, keyed on the submitted index', () => {
  const { errors } = validateSocialLinks([
    { network: 'instagram', url: IG },
    { network: 'myspace', url: 'https://myspace.com/a' },
    { network: 'facebook', url: 'facebook.com/a' },
    { network: 'tiktok', url: 'https://example.com/a' },
    { network: 'instagram', url: 'https://instagram.com/b' },
    { network: 'youtube', url: 'ftp://youtube.com/a' },
  ]);
  assert.deepEqual(errors, {
    'socialLinks.1.network': 'Réseau inconnu.',
    'socialLinks.2.url': 'URL invalide.',
    'socialLinks.3.url': 'Lien d\'un autre réseau.',
    'socialLinks.4.network': 'Déjà dans la liste.',
    'socialLinks.5.url': 'Doit commencer par http:// ou https://.',
  });
});

test('rule 37: more than 8 entries are refused; a non-list too', () => {
  const nine = Array.from({ length: 9 }, () => ({ network: 'instagram', url: '' }));
  assert.equal(validateSocialLinks(nine).errors.socialLinks, '8 liens au plus.');
  assert.equal(validateSocialLinks('x').errors.socialLinks, 'Liste invalide.');
  assert.equal(validateSocialLinks(Array.from({ length: 8 }, () => ({ network: 'instagram', url: '' }))).errors.socialLinks, undefined);
});

test('rule 37: whitespace is trimmed and an entry with an empty URL is dropped, not refused', () => {
  const { links, errors } = validateSocialLinks([{ network: 'facebook', url: '  ' }, { network: 'instagram', url: `  ${IG}\n` }]);
  assert.deepEqual(errors, {});
  assert.deepEqual(links, [{ network: 'instagram', url: IG }]);
});

test('rule 38: the operator\'s order is kept through a save and a read', async () => {
  const res = await put({ socialLinks: [{ network: 'facebook', url: FB }, { network: 'instagram', url: IG }, { network: 'youtube', url: 'https://youtube.com/@a' }] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(storedList().map((l) => l.network), ['facebook', 'instagram', 'youtube']);
  assert.deepEqual(res.body.emails.socialLinks.map((l) => l.network), ['facebook', 'instagram', 'youtube']);
});

test('rule 37: a refused save answers 400 with the indexed errors and writes nothing', async () => {
  const before = stored();
  const res = await put({ socialLinks: [{ network: 'facebook', url: FB }, { network: 'instagram', url: FB }] });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'SETTINGS_INVALID');
  assert.equal(res.body.errors['socialLinks.1.url'], 'Lien d\'un autre réseau.');
  assert.deepEqual(stored(), before);
});

test('rule 42: instagramUrl follows the Instagram entry of the list, or empties', async () => {
  await put({ socialLinks: [{ network: 'facebook', url: FB }, { network: 'instagram', url: IG }] });
  assert.equal(stored().instagramUrl, IG);
  await put({ socialLinks: [{ network: 'facebook', url: FB }] });
  assert.equal(stored().instagramUrl, '');
  assert.equal(instagramUrlOf([{ network: 'instagram', url: IG }]), IG);
});

test('rule 43: an older client sending instagramUrl replaces the Instagram entry and keeps the others', async () => {
  await put({ socialLinks: [{ network: 'instagram', url: IG }, { network: 'facebook', url: FB }] });
  const res = await put({ instagramUrl: 'https://instagram.com/nouveau' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(storedList(), [{ network: 'instagram', url: 'https://instagram.com/nouveau' }, { network: 'facebook', url: FB }]);
  assert.equal(stored().instagramUrl, 'https://instagram.com/nouveau');
  await put({ instagramUrl: '' });
  assert.deepEqual(storedList(), [{ network: 'facebook', url: FB }]);
  assert.equal(stored().instagramUrl, '');
  assert.equal((await put({ instagramUrl: 'pas une url' })).statusCode, 400);
});

test('rule 43: the merge helper appends when there is no Instagram entry yet', () => {
  assert.deepEqual(mergeLegacyInstagram([{ network: 'facebook', url: FB }], IG), [{ network: 'facebook', url: FB }, { network: 'instagram', url: IG }]);
});

test('rule 35: an empty list is allowed', async () => {
  const res = await put({ socialLinks: [] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(storedList(), []);
});

function renderJ1(settings, lang = 'fr', platform = 'direct') {
  const def = DEFAULT_TEMPLATES.find((t) => t.stableKey === MAIL.J1);
  const context = buildContext({
    reservation: { id: 1, startDate: '2027-07-10', endDate: '2027-07-17', createdAt: '2027-03-02', adults: 2, finalPrice: 1240, platform },
    client: { id: 1, firstName: 'Camille', email: 'c@x.fr' },
    property: { id: 1, name: 'Maison test', nameArticle: 'à' },
    options: [],
    stayFacts: { optionMeta: {}, defaults: [], available: [], properties: [{ id: 1, name: 'Maison test', nameArticle: 'à', minNightlyPrice: 319 }] },
    settings: { companyName: 'Maison', googleReviewUrl: 'https://g.page/r/x/review', ...settings },
    lang,
    sequence: {},
  });
  const side = lang === 'en' ? { subject: def.subjectEn, body: def.bodyEn } : { subject: def.subject, body: def.body };
  return renderTemplate(side, context).body;
}

const GOLDEN_FR = `Bonjour Camille,

Merci d'avoir séjourné chez nous. Nous espérons que votre séjour à Maison test vous a plu.

Si vous en avez envie, quelques mots sur notre page Google nous aideraient beaucoup : https://g.page/r/x/review.

Si quelque chose a manqué à votre séjour, même un détail, il suffit de répondre à ce mail : nous aimerions le savoir.

Pour suivre nos nouvelles : https://www.instagram.com/exemple

Au plaisir de vous accueillir à nouveau,
Maison`;

test('rule 39 (golden): the J+1 e-mail is byte-identical for existing data, with or without the list', () => {
  const legacyOnly = { instagramUrl: IG };
  const migrated = { instagramUrl: IG, socialLinks: JSON.stringify([{ network: 'instagram', url: IG }]) };
  assert.equal(renderJ1(legacyOnly), GOLDEN_FR);
  assert.equal(renderJ1(migrated), GOLDEN_FR);
  assert.equal(renderJ1(migrated, 'en'), renderJ1(legacyOnly, 'en'));
  assert.match(renderJ1(migrated, 'en'), /To follow our news: https:\/\/www\.instagram\.com\/exemple$/m);
  const odd = 'https://instagram.com/x?igsh=abc&utm=1';
  assert.equal(renderJ1({ instagramUrl: odd, socialLinks: JSON.stringify([{ network: 'instagram', url: odd }]) }, 'fr', 'Booking'),
    renderJ1({ instagramUrl: odd }, 'fr', 'Booking'));
});

test('rule 39: no link, no paragraph (and no stray blank line)', () => {
  const body = renderJ1({ instagramUrl: '', socialLinks: '[]' });
  assert.doesNotMatch(body, /Pour suivre nos nouvelles/);
  assert.doesNotMatch(body, /\n{3,}/);
});

test('rule 39: two links or more expand to one « Network : url » line each, in the operator\'s order', () => {
  const links = [{ network: 'facebook', url: FB }, { network: 'instagram', url: IG }];
  assert.equal(renderSocialLinks(links, 'fr'), `\nFacebook : ${FB}\nInstagram : ${IG}`);
  assert.equal(renderSocialLinks(links, 'en'), `\nFacebook: ${FB}\nInstagram: ${IG}`);
  assert.match(renderJ1({ socialLinks: JSON.stringify(links) }), new RegExp(`Pour suivre nos nouvelles : \\nFacebook : ${FB.replace(/[.]/g, '\\.')}\\nInstagram : ${IG.replace(/[.]/g, '\\.')}`));
  assert.doesNotMatch(renderJ1({ socialLinks: JSON.stringify(links) }), /: Facebook :/);
});

test('rule 40: the paragraph key and the tokens keep their names', () => {
  const tokens = require('../utils/templateTokens');
  const names = JSON.stringify(tokens);
  assert.match(names, /instagramParagraph/);
  assert.match(names, /hasInstagram/);
  const def = DEFAULT_TEMPLATES.find((t) => t.stableKey === MAIL.J1);
  assert.match(def.body, /\{\{#if hasInstagram\}\}\{\{instagramParagraph\}\}/);
});

test('rule 44: nowhere else yet — only settings, the J+1 context and the migration read the links', () => {
  const root = path.join(__dirname, '..');
  const readers = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'tests') walk(full); continue; }
      if (entry.name.endsWith('.js') && fs.readFileSync(full, 'utf8').includes('socialLinks')) readers.push(path.relative(root, full));
    }
  };
  walk(root);
  assert.deepEqual(readers.sort(), [
    'controllers/settingsController.js', 'database.js', 'models/settingsModel.js', 'utils/guestEmailSequenceSchema.js',
    'utils/settingsResponse.js', 'utils/socialLinks.js', 'utils/socialLinksMigration.js', 'utils/stayContentContext.js',
  ]);
});

test('rule 37: a URL holding a space is refused, in the list and through the legacy input', async () => {
  assert.equal(validateSocialLinks([{ network: 'instagram', url: 'https://instagram.com/a b' }]).errors['socialLinks.0.url'], 'URL invalide.');
  const res = await put({ instagramUrl: 'https://instagram.com/a b' });
  assert.equal(res.statusCode, 400);
});

test('rule 43: the legacy instagramUrl is held to the Instagram host like a list entry', async () => {
  const before = stored();
  const res = await put({ instagramUrl: 'https://facebook.com/pas-instagram' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errors.instagramUrl, 'Lien d\'un autre réseau.');
  assert.deepEqual(stored(), before);
});

test('rule 37: the cap of 8 guards the raw API — with one entry per network the form reaches 7', () => {
  assert.equal(SOCIAL_NETWORKS.length, 7);
  assert.ok(require('../utils/socialLinks').MAX_SOCIAL_LINKS >= SOCIAL_NETWORKS.length);
});
