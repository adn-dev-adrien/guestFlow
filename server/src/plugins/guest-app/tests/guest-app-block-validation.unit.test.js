// specs/guest-app.md rule 18 — the closed list of block types, each one's data judged at the boundary, rich text
// sanitised on the server (paragraphs, bold, italic, lists, links to https: / tel: / mailto: only), and a button
// whose target the session cannot follow left out of the guest's payload.
const test = require('node:test');
const assert = require('node:assert/strict');

const { BLOCK_TYPES, sanitizeRichText, validateBlockData } = require('../bookletBlocks');
const { resolvePages } = require('../booklet');
const {
  addOption, addStay, enable, freshDb, livePlugins, sell, startApi,
} = require('./guestAppFixtures');

const fr = (text) => ({ fr: text });
const ok = (type, data) => {
  const result = validateBlockData(type, data);
  assert.equal(result.error, undefined, `${type}: ${result.error}`);
  return result.data;
};
const refused = (type, data, label) => assert.equal(typeof validateBlockData(type, data).error, 'string', label);

const VALID = {
  text: { html: { fr: '<p>Bonjour</p>', en: '<p>Hello</p>' } },
  image: { mediaId: 3, caption: fr('La terrasse') },
  gallery: { items: [{ mediaId: 1 }, { mediaId: 2, caption: fr('Le pré') }] },
  callout: { tone: 'warning', title: fr('Attention'), text: fr('Le chemin est glissant.') },
  steps: { steps: [{ text: fr('Ouvrez la trappe.'), mediaId: 4 }, { text: fr('Allumez.') }] },
  wifi: {},
  contact: { source: 'inline', name: 'Adrien', role: { fr: 'Votre hôte', en: 'Your host' }, phone: '+33 6 00 00 00 00', email: 'adrien@example.test' },
  place: { name: fr('Boulangerie'), address: 'Place du village, Satillieu', lat: 45.15, lng: 4.61 },
  faq: { items: [{ question: fr('Où sont les draps ?'), answer: fr('Dans l’armoire.') }] },
  button: { label: fr('Voir le départ'), target: { kind: 'page', slug: 'depart' } },
  hours: { title: fr('Boulangerie'), rows: [{ label: fr('Lundi'), value: fr('7 h – 12 h') }] },
};

test('rule 18: the closed list, each type with a valid sample', () => {
  assert.deepEqual([...BLOCK_TYPES].sort(), Object.keys(VALID).sort());
  Object.entries(VALID).forEach(([type, data]) => ok(type, data));
  refused('video', { url: 'https://x.test' }, 'not in the list');
  refused('text', { html: fr('x'), color: 'red' }, 'an unknown key');
  refused('text', null, 'no data');
});

test('rules 18, 19: French is required, English may fall back; lengths are bounded', () => {
  refused('callout', { tone: 'info', text: { en: 'English only' } }, 'no French');
  refused('callout', { tone: 'info', text: { fr: '   ' } }, 'blank French');
  refused('callout', { tone: 'info', text: { fr: 'x'.repeat(2001) } }, 'too long');
  refused('callout', { tone: 'info', text: { fr: 12 } }, 'not text');
  refused('callout', { tone: 'info', text: { fr: 'x', de: 'y' } }, 'a third language');
  assert.deepEqual(ok('callout', { tone: 'info', text: { fr: ' Bonjour ', en: '' } }).text, { fr: 'Bonjour' }, 'an empty English is no English');
  assert.deepEqual(ok('text', { html: { fr: '<p>Bonjour</p>', en: '<p> </p>' } }).html, { fr: '<p>Bonjour</p>' }, 'markup without text is empty');
  refused('text', { html: { fr: '<script>x</script>' } }, 'nothing left once sanitised');
});

test('rule 18: each type refuses its own malformed data', () => {
  refused('callout', { tone: 'danger', text: fr('x') }, 'tone');
  refused('image', { mediaId: '3' }, 'media id as text');
  refused('gallery', { items: [] }, 'an empty gallery');
  refused('gallery', { items: Array.from({ length: 31 }, () => ({ mediaId: 1 })) }, '31 photos');
  refused('steps', { steps: [{ text: fr('x'), mediaId: 0 }] }, 'a step photo 0');
  refused('wifi', { network: 'Solio' }, 'the network is a lodging fact');
  refused('contact', { source: 'inline', name: 'Adrien' }, 'no way to reach them');
  refused('contact', { source: 'inline', name: 'Adrien', phone: 'call me' }, 'a phone that is not one');
  refused('contact', { source: 'inline', name: 'Adrien', email: 'adrien' }, 'an e-mail that is not one');
  refused('contact', { source: 'lodging', name: 'Adrien' }, 'the lodging source carries nothing else');
  refused('place', { name: fr('x'), address: 'y', lat: 91, lng: 0 }, 'a latitude off the globe');
  refused('place', { name: fr('x'), address: 'y', lat: 45 }, 'half a point');
  refused('faq', { items: [{ question: fr('x') }] }, 'a question without answer');
  refused('hours', { rows: Array.from({ length: 15 }, () => ({ label: fr('x'), value: fr('y') })) }, '15 rows');
  assert.deepEqual(ok('contact', { source: 'lodging' }), { source: 'lodging' });
});

test('rule 18: a button targets a page, a sold item or an https address — nothing else', () => {
  const button = (target) => ({ label: fr('Aller'), target });
  ok('button', button({ kind: 'item', itemKind: 'resource', itemId: 4 }));
  ok('button', button({ kind: 'url', href: 'https://map.domainesolio.com/#plage' }));
  refused('button', button({ kind: 'page', slug: 'Départ' }), 'a slug with capitals and accents');
  refused('button', button({ kind: 'item', itemKind: 'room', itemId: 4 }), 'an unknown item kind');
  refused('button', button({ kind: 'item', itemKind: 'option', itemId: '4' }), 'an id as text');
  refused('button', button({ kind: 'url', href: 'http://example.test' }), 'plain http');
  refused('button', button({ kind: 'url', href: 'javascript:alert(1)' }), 'a script');
  refused('button', button({ kind: 'url', href: 'https://x.test', target: '_blank' }), 'an unknown key');
  refused('button', button({ kind: 'phone', number: '+33' }), 'an unknown kind');
});

test('rule 18: rich text keeps paragraphs, bold, italic, lists and safe links', () => {
  assert.equal(sanitizeRichText('<p>Le <b>poêle</b> et <i>la</i> <strong>cheminée</strong></p>'), '<p>Le <strong>poêle</strong> et <em>la</em> <strong>cheminée</strong></p>');
  assert.equal(sanitizeRichText('<ul><li>Un</li><li>Deux</li></ul><ol><li>Trois</li></ol>'), '<ul><li>Un</li><li>Deux</li></ul><ol><li>Trois</li></ol>');
  assert.equal(sanitizeRichText('Ligne<br/>suivante'), 'Ligne<br>suivante');
  assert.equal(sanitizeRichText('<a href="https://domainesolio.com" target="_blank">site</a>'), '<a href="https://domainesolio.com" rel="noopener noreferrer">site</a>');
  assert.equal(sanitizeRichText('<a href="tel:+33600000000">Appeler</a> <a href=\'mailto:a@b.fr\'>Écrire</a>'),
    '<a href="tel:+33600000000" rel="noopener noreferrer">Appeler</a> <a href="mailto:a@b.fr" rel="noopener noreferrer">Écrire</a>');
});

test('rule 18: rich text loses scripts, handlers, other tags and unsafe links — the text stays, escaped', () => {
  assert.equal(sanitizeRichText('<p onclick="steal()">Bonjour<script>alert(1)</script></p>'), '<p>Bonjour</p>');
  assert.equal(sanitizeRichText('<style>p{}</style><iframe src="https://x.test">x</iframe>Texte'), 'Texte');
  assert.equal(sanitizeRichText('<div><span style="color:red">rouge</span></div><img src=x onerror=alert(1)>'), 'rouge');
  ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'jav&#x61;script:alert(1)', ' javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,x', 'http://x.test', '//x.test', 'tel:abc']
    .forEach((href) => assert.equal(sanitizeRichText(`<a href="${href}">lien</a>`), 'lien', href));
  assert.equal(sanitizeRichText('2 < 3 & 4 > 1'), '2 &lt; 3 &amp; 4 &gt; 1');
  assert.equal(sanitizeRichText('<!-- note --><p>Ouvert</p>'), '<p>Ouvert</p>');
  assert.equal(sanitizeRichText('<p><strong>gras'), '<p><strong>gras</strong></p>', 'unclosed tags are closed');
  assert.equal(sanitizeRichText('</em>texte</p>'), 'texte', 'a stray closing tag is dropped');
  assert.equal(sanitizeRichText('<a href="https://a.test"><a href="https://b.test">x</a></a>'), '<a href="https://a.test" rel="noopener noreferrer">x</a>', 'no link inside a link');
  assert.equal(sanitizeRichText('<p title="a > b">x</p>'), '<p>x</p>', 'a > inside an attribute ends nothing');
  assert.equal(sanitizeRichText('<a href="https://x.test/?a=1&b=2">x</a>'), '<a href="https://x.test/?a=1&amp;b=2" rel="noopener noreferrer">x</a>');
  assert.equal(ok('text', { html: fr('<p>Salut<script>x</script></p>') }).html.fr, '<p>Salut</p>', 'the stored text is the sanitised one');
});

test('rule 18: in the payload, a button to a page outside the booklet or to an item the session cannot reach is dropped', () => {
  const page = (slug, blocks) => ({ slug, title: fr(slug), blocks: blocks.map((b, id) => ({ id, ...b })) });
  const button = (target) => ({ type: 'button', data: { label: fr('Aller'), target } });
  const pages = [page('accueil', [
    button({ kind: 'page', slug: 'depart' }),
    button({ kind: 'page', slug: 'secret' }),
    button({ kind: 'item', itemKind: 'option', itemId: 1 }),
    button({ kind: 'url', href: 'https://map.example.test' }),
  ]), page('depart', [])];
  const resolve = (isAvailable) => resolvePages(pages, {
    lang: 'fr', facts: { wifi: null, noWifi: fr('Pas de wifi'), contacts: [] }, mediaOf: () => null, isAvailable,
  })[0].blocks.map((b) => b.target.slug || b.target.kind);
  assert.deepEqual(resolve((t) => t.kind === 'url'), ['depart', 'url'], 'the item is not reachable');
  assert.deepEqual(resolve(() => false), ['depart'], 'a page target is judged by the booklet itself');
  assert.deepEqual(resolve((t) => t.kind === 'url' || t.itemId === 1), ['depart', 'item', 'url']);
});

test('rule 18: an item button shows for a stay whose lodging sells it, never for a visitor nor once unsold', async () => {
  const teardown = livePlugins();
  const db = freshDb();
  const ctx = await startApi(db);
  try {
    const code = enable(ctx.api, db);
    addOption(db, { id: 1, title: 'Cidre' });
    addOption(db, { id: 2, title: 'Jus' });
    sell(db, 'option', 1);
    const model = require('../models/bookletModel')(db);
    const { page } = model.createPage(1, { slug: 'accueil', title: fr('Accueil') }, ctx.clock.now);
    [1, 2].forEach((itemId) => model.createBlock(page.id, { type: 'button', data: { label: fr(`Article ${itemId}`), target: { kind: 'item', itemKind: 'option', itemId } } }, ctx.clock.now));
    model.publish(1, { at: ctx.clock.now });
    const targets = async () => (await ctx.call('GET', '/public/v1/guest/booklet/pages/accueil')).body.data.blocks.map((b) => b.target.itemId);

    await ctx.call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
    assert.deepEqual(await targets(), [], 'a visitor never reaches the shop');
    addStay(db);
    ctx.cookies.value = null;
    await ctx.call('POST', '/public/v1/guest/sessions', { lodgingCode: code });
    assert.deepEqual(await targets(), [1], 'the sold item only');
    sell(db, 'option', 1, { sold: 0 });
    assert.deepEqual(await targets(), [], 'unsold → gone, without republishing');
  } finally {
    await ctx.close();
    teardown();
  }
});
