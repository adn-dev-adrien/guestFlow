// specs/guest-app.md rules 16-17 — one booklet per lodging, shared pages edited once, restricted blocks, duplicates
// that diverge; rules 19-20 — the EN → FR fallback per field and the accent-insensitive search; rules 48-49 — the
// studio edits a draft, « Publier » publishes one lodging (and a shared page everywhere it is placed), guests read
// the last published version; rule 11ter — the wifi and contact blocks read the lodging's facts. Through the routes.
const test = require('node:test');
const assert = require('node:assert/strict');

const { enable, freshDb, startApi } = require('./guestAppFixtures');
const { defaultModules } = require('../modules');

const STUDIO = '/api/guest-app/studio';
const fr = (text) => ({ fr: text });
const text = (frText, en) => ({ type: 'text', data: { html: en ? { fr: `<p>${frText}</p>`, en: `<p>${en}</p>` } : { fr: `<p>${frText}</p>` } } });

function withBooklet(name, fn) {
  test(name, async () => {
    const db = freshDb();
    const ctx = await startApi(db);
    try {
      const codes = { 1: enable(ctx.api, db, 1), 2: enable(ctx.api, db, 2) };
      const studio = {
        page: async (propertyId, slug, title, blocks = []) => {
          const created = await ctx.call('POST', `${STUDIO}/lodgings/${propertyId}/pages`, { slug, title });
          assert.equal(created.status, 200, JSON.stringify(created.body));
          for (const block of blocks) {
            // eslint-disable-next-line no-await-in-loop
            const added = await ctx.call('POST', `${STUDIO}/pages/${created.body.id}/blocks`, block);
            assert.equal(added.status, 200, JSON.stringify(added.body));
          }
          return created.body;
        },
        publish: (propertyId) => ctx.call('POST', `${STUDIO}/lodgings/${propertyId}/publish`),
        booklet: async (propertyId) => (await ctx.call('GET', `${STUDIO}/lodgings/${propertyId}/booklet`)).body,
      };
      // A visitor of each lodging reads through the printed code, without a cookie.
      const guest = (propertyId, path, lang = 'fr') => {
        const join = path.includes('?') ? '&' : '?';
        return ctx.call('GET', `/public/v1/guest/booklet${path}${join}lang=${lang}&lodgingCode=${codes[propertyId]}`, undefined, { cookie: null });
      };
      const index = async (propertyId, lang) => (await guest(propertyId, '', lang)).body.data.pages.map((p) => p.slug);
      await fn({ db, ctx, codes, studio, guest, index });
    } finally {
      await ctx.close();
    }
  });
}

withBooklet('rule 16: each lodging reads only its own pages, in its own order', async ({ ctx, studio, index }) => {
  const shared = await studio.page(1, 'le-domaine', fr('Le domaine'), [text('Le calme après 22 h.')]);
  await studio.page(1, 'le-poele', fr('Le poêle à bois'), [text('Ouvrez le tirage.')]);
  await studio.page(2, 'la-piscine', fr('La piscine'), [text('Ouverte en été.')]);
  assert.equal((await ctx.call('POST', `${STUDIO}/pages/${shared.id}/placements`, { propertyId: 2 })).status, 200);

  const second = await studio.booklet(2);
  const order = second.pages.map((p) => p.id).reverse();
  const put = await ctx.call('PUT', `${STUDIO}/lodgings/2/booklet`, { pages: order.map((pageId, sortOrder) => ({ pageId, sortOrder, published: true })) });
  assert.equal(put.status, 200);
  await studio.publish(1);
  await studio.publish(2);

  assert.deepEqual(await index(1), ['le-domaine', 'le-poele']);
  assert.deepEqual(await index(2), ['le-domaine', 'la-piscine'], 'its own order: the shared page moved first');
  assert.deepEqual((await studio.booklet(1)).pages[0].sharedWith, [{ propertyId: 2, name: 'L\'Estiva' }], '« Partagée avec L\'Estiva »');
});

withBooklet('rule 17: a shared page edited once changes in both lodgings; publishing it republishes it everywhere', async ({ ctx, studio, guest, index }) => {
  const shared = await studio.page(1, 'le-domaine', fr('Le domaine'), [text('Le calme après 22 h.')]);
  await ctx.call('POST', `${STUDIO}/pages/${shared.id}/placements`, { propertyId: 2 });
  await studio.page(2, 'la-piscine', fr('La piscine'), [text('Ouverte en été.')]);
  await studio.publish(1);
  await studio.publish(2);

  const block = (await ctx.call('GET', `${STUDIO}/pages/${shared.id}`)).body.blocks[0];
  await ctx.call('PUT', `${STUDIO}/blocks/${block.id}`, { data: { html: fr('<p>Le calme après 23 h.</p>') } });
  await ctx.call('POST', `${STUDIO}/lodgings/2/pages`, { slug: 'brouillon', title: fr('Brouillon de L\'Estiva') });
  const published = await studio.publish(1);
  assert.deepEqual(published.body.versions.map((v) => v.propertyId), [1, 2]);

  for (const propertyId of [1, 2]) {
    // eslint-disable-next-line no-await-in-loop
    const page = (await guest(propertyId, '/pages/le-domaine')).body.data;
    assert.equal(page.blocks[0].html, '<p>Le calme après 23 h.</p>', `lodging ${propertyId}`);
  }
  assert.deepEqual(await index(2), ['le-domaine', 'la-piscine'], 'L\'Estiva\'s own draft page stays unpublished');
});

withBooklet('rule 17: a block restricted to one lodging is filtered out of the other', async ({ ctx, studio, guest }) => {
  const shared = await studio.page(1, 'le-domaine', fr('Le domaine'), [text('Pour tous.')]);
  await ctx.call('POST', `${STUDIO}/pages/${shared.id}/placements`, { propertyId: 2 });
  const only = await ctx.call('POST', `${STUDIO}/pages/${shared.id}/blocks`, { ...text('Le poêle de La Granja.'), onlyForPropertyIds: [1] });
  assert.deepEqual(only.body.onlyForPropertyIds, [1]);
  assert.equal((await ctx.call('POST', `${STUDIO}/pages/${shared.id}/blocks`, { ...text('x'), onlyForPropertyIds: [3] })).status, 400, 'only lodgings the page is placed in');
  await studio.publish(1);
  await studio.publish(2);
  const blocksOf = async (propertyId) => (await guest(propertyId, '/pages/le-domaine')).body.data.blocks.map((b) => b.html);
  assert.deepEqual(await blocksOf(1), ['<p>Pour tous.</p>', '<p>Le poêle de La Granja.</p>']);
  assert.deepEqual(await blocksOf(2), ['<p>Pour tous.</p>']);

  await ctx.call('DELETE', `${STUDIO}/pages/${shared.id}/placements/1`);
  assert.deepEqual((await ctx.call('GET', `${STUDIO}/pages/${shared.id}`)).body.blocks[1].onlyForPropertyIds, [], 'unshared: the block is now for no lodging');
  assert.equal((await ctx.call('DELETE', `${STUDIO}/pages/${shared.id}/placements/2`)).status, 409, 'the last placement is deleted, not unshared');
});

withBooklet('rule 17: « Dupliquer vers… » makes an independent copy that diverges', async ({ ctx, studio, guest }) => {
  const source = await studio.page(1, 'depart', fr('Départ'), [text('Clés sur la table.'), { ...text('Le poêle éteint.'), onlyForPropertyIds: [1] }]);
  await studio.page(2, 'depart', fr('Départ de L\'Estiva'));
  const copy = await ctx.call('POST', `${STUDIO}/pages/${source.id}/duplicate`, { toPropertyId: 2 });
  assert.equal(copy.status, 200);
  assert.equal(copy.body.slug, 'depart-2', 'the slug taken there gets a number');
  assert.deepEqual(copy.body.placements.map((p) => p.propertyId), [2]);
  const copied = copy.body.blocks[0];
  await ctx.call('PUT', `${STUDIO}/blocks/${copied.id}`, { data: { html: fr('<p>Clés dans la boîte.</p>') } });
  await studio.publish(1);
  await studio.publish(2);
  assert.deepEqual((await guest(1, '/pages/depart')).body.data.blocks.map((b) => b.html), ['<p>Clés sur la table.</p>', '<p>Le poêle éteint.</p>']);
  assert.deepEqual((await guest(2, '/pages/depart-2')).body.data.blocks.map((b) => b.html), ['<p>Clés dans la boîte.</p>'], 'only what L\'Estiva would read was copied');
});

withBooklet('rules 48-49: guests read the published version; the draft and the other lodging wait for their own « Publier »', async ({ ctx, studio, guest, index }) => {
  assert.deepEqual((await guest(1, '')).body.data, { version: null, pages: [] }, 'never published → empty');
  const page = await studio.page(1, 'bienvenue', fr('Bienvenue'), [text('Bonjour.')]);
  await studio.page(2, 'bienvenue', fr('Bienvenue à L\'Estiva'), [text('Salut.')]);
  assert.deepEqual(await index(1), [], 'a draft is not read');
  const first = await studio.publish(1);
  assert.deepEqual(await index(1), ['bienvenue']);
  assert.deepEqual(await index(2), [], 'one lodging published, not the other');
  assert.equal((await studio.booklet(1)).upToDate, true);

  await ctx.call('PUT', `${STUDIO}/pages/${page.id}`, { title: fr('Bienvenue au domaine') });
  assert.equal((await guest(1, '')).body.data.pages[0].title, 'Bienvenue', 'the guest keeps the previous version');
  assert.equal((await studio.booklet(1)).upToDate, false);
  const second = await studio.publish(1);
  assert.ok(second.body.versions[0].id > first.body.versions[0].id);
  const read = (await guest(1, '')).body.data;
  assert.equal(read.pages[0].title, 'Bienvenue au domaine');
  assert.equal(read.version, second.body.versions[0].id);

  const placements = (await studio.booklet(1)).pages.map((p) => ({ pageId: p.id, sortOrder: 0, published: false }));
  await ctx.call('PUT', `${STUDIO}/lodgings/1/booklet`, { pages: placements });
  await studio.publish(1);
  assert.deepEqual(await index(1), [], 'unpublished in this lodging');
  assert.equal((await guest(1, '/pages/bienvenue')).body.error.code, 'PAGE_NOT_FOUND');
});

withBooklet('rule 19: English falls back to French per field; the studio counts what is not translated', async ({ ctx, studio, guest }) => {
  await studio.page(1, 'arrivee', { fr: 'Arrivée', en: 'Arrival' }, [
    text('Les clés sont dans la boîte.', 'The keys are in the box.'),
    { type: 'callout', data: { tone: 'info', title: fr('Parking'), text: { fr: 'Garez-vous devant la grange.' } } },
  ]);
  await studio.publish(1);
  const page = (await guest(1, '/pages/arrivee', 'en')).body.data;
  assert.equal(page.title, 'Arrival');
  assert.equal(page.blocks[0].html, '<p>The keys are in the box.</p>');
  assert.equal(page.blocks[1].text, 'Garez-vous devant la grange.', 'no English → the French');
  assert.equal((await studio.booklet(1)).untranslated, 2, '« 2 textes non traduits »: the callout title and text');
  const preview = await ctx.call('GET', `${STUDIO}/lodgings/1/preview?lang=en`);
  assert.equal(preview.body.untranslated, 2);
  assert.equal(preview.body.pages[0].title, 'Arrival');
});

withBooklet('rule 20: search covers titles and texts, ignores accents and case, and returns the matching sentence', async ({ ctx, studio, guest }) => {
  await studio.page(1, 'le-logement', fr('Le logement'), [text('Bienvenue. Le poêle à bois chauffe toute la maison. Rallumez-le le soir.')]);
  await studio.page(1, 'depart', fr('Départ'), [{ type: 'faq', data: { items: [{ question: fr('Où laisser les clés ?'), answer: fr('Sur la table de la cuisine.') }] } }]);
  await studio.publish(1);
  const search = async (q) => (await guest(1, `/search?q=${encodeURIComponent(q)}`)).body;
  const poele = await search('POELE');
  assert.deepEqual(poele.data.results.map((r) => r.slug), ['le-logement']);
  const [hit] = poele.data.results;
  assert.equal(hit.excerpt, 'Le poêle à bois chauffe toute la maison.');
  assert.equal(hit.excerpt.slice(hit.highlight.start, hit.highlight.start + hit.highlight.length), 'poêle');
  assert.deepEqual((await search('depart')).data.results.map((r) => r.slug), ['depart'], 'a title, accents ignored');
  assert.deepEqual((await search('cuisine')).data.results.map((r) => r.excerpt), ['Sur la table de la cuisine.'], 'a FAQ answer');
  assert.deepEqual((await search('piscine')).data.results, []);
  assert.equal((await search('a')).error.code, 'INVALID_INPUT', 'too short');
  const studioSearch = await ctx.call('GET', `${STUDIO}/lodgings/1/search?q=rallumez`);
  assert.equal(studioSearch.body.results[0].excerpt, 'Rallumez-le le soir.');
});

withBooklet('rule 11ter: the wifi and contact blocks read the lodging, not the booklet — one change, both follow', async ({ db, ctx, studio, guest }) => {
  const lodgings = require('../models/lodgingsModel')(db);
  lodgings.save(1, { wifi: { available: true, network: 'Solio', password: 'chevre-blanche' }, contacts: [{ name: 'Adrien', phone: '06 00 00 00 00' }] });
  await studio.page(1, 'infos', fr('Infos'), [{ type: 'wifi', data: {} }, { type: 'contact', data: { source: 'lodging' } }]);
  await studio.publish(1);
  let blocks = (await guest(1, '/pages/infos')).body.data.blocks;
  assert.equal(blocks[0].network, 'Solio');
  assert.equal(blocks[0].password, 'chevre-blanche');
  assert.match(blocks[0].joinQr, /^data:image\/png;base64,/);
  assert.deepEqual(blocks[1].contacts, [{ name: 'Adrien', phone: '06 00 00 00 00', telUrl: 'tel:0600000000' }]);

  lodgings.save(1, { wifi: { available: true, network: 'Solio', password: 'picodon' } });
  assert.equal((await guest(1, '/pages/infos')).body.data.blocks[0].password, 'picodon', 'no republication needed');
  lodgings.save(1, { wifi: { available: false }, contacts: [] });
  blocks = (await guest(1, '/pages/infos')).body.data.blocks;
  assert.deepEqual(blocks, [{ type: 'wifi', available: false, text: 'À La Granja, il n’y a pas de wifi.' }], 'no wifi → the message; no contact → no block');
});

withBooklet('rules 5, 11bis: a visitor reads the booklet by the printed code; the module off is 404 MODULE_OFF', async ({ db, ctx, studio, guest, codes }) => {
  await studio.page(1, 'bienvenue', fr('Bienvenue'), [text('Bonjour.')]);
  await studio.publish(1);
  assert.equal((await ctx.call('GET', '/public/v1/guest/booklet', undefined, { cookie: null })).status, 401, 'neither session nor code');
  assert.equal((await ctx.call('GET', '/public/v1/guest/booklet?lodgingCode=guess', undefined, { cookie: null })).status, 401);
  await ctx.call('POST', '/public/v1/guest/sessions', { lodgingCode: codes[1] });
  assert.deepEqual((await ctx.call('GET', '/public/v1/guest/booklet')).body.data.pages.map((p) => p.slug), ['bienvenue'], 'a visitor session');
  const modules = defaultModules().map((m) => (m.key === 'booklet' ? { ...m, on: false } : m));
  require('../models/lodgingsModel')(db).save(1, { modules });
  const off = await guest(1, '');
  assert.equal(off.status, 404);
  assert.equal(off.body.error.code, 'MODULE_OFF');
  assert.equal((await guest(1, '/search?q=bonjour')).body.error.code, 'MODULE_OFF');
});

withBooklet('rules 16, 48: slugs are unique inside one booklet, the lists name every page or block once', async ({ ctx, studio }) => {
  const page = await studio.page(1, 'bienvenue', fr('Bienvenue'), [text('Un.'), text('Deux.')]);
  const other = await studio.page(2, 'bienvenue', fr('Bienvenue'));
  assert.equal((await ctx.call('POST', `${STUDIO}/lodgings/1/pages`, { slug: 'bienvenue', title: fr('Encore') })).status, 409);
  assert.equal((await ctx.call('POST', `${STUDIO}/pages/${other.id}/placements`, { propertyId: 1 })).status, 409, 'the slug is taken there');
  assert.equal((await ctx.call('POST', `${STUDIO}/pages/${page.id}/placements`, { propertyId: 1 })).status, 409, 'already placed');
  assert.equal((await ctx.call('PUT', `${STUDIO}/lodgings/1/booklet`, { pages: [] })).status, 400, 'a page left out');

  const ids = (await ctx.call('GET', `${STUDIO}/pages/${page.id}`)).body.blocks.map((b) => b.id);
  assert.equal((await ctx.call('PUT', `${STUDIO}/pages/${page.id}/blocks/order`, { blockIds: [ids[0]] })).status, 400);
  const reordered = await ctx.call('PUT', `${STUDIO}/pages/${page.id}/blocks/order`, { blockIds: [...ids].reverse() });
  assert.deepEqual(reordered.body.blocks.map((b) => b.data.html.fr), ['<p>Deux.</p>', '<p>Un.</p>']);
  assert.equal((await ctx.call('DELETE', `${STUDIO}/blocks/${ids[0]}`)).status, 200);
  assert.equal((await ctx.call('DELETE', `${STUDIO}/pages/${page.id}`)).status, 200);
  assert.equal((await ctx.call('GET', `${STUDIO}/pages/${page.id}`)).status, 404);
  assert.equal((await ctx.call('POST', `${STUDIO}/pages/${other.id}/blocks`, { type: 'image', data: { mediaId: 99 } })).status, 400, 'an unknown photo');
});

test('§9 Q1: a lodging entering the app starts with the neutral pages, marked as placeholders, once', async () => {
  const db = freshDb();
  const ctx = await startApi(db);
  try {
    assert.equal((await ctx.call('PUT', '/api/guest-app/lodgings/1', { enabled: true })).status, 200);
    const seeded = (await ctx.call('GET', `${STUDIO}/lodgings/1/booklet`)).body.pages;
    assert.deepEqual(seeded.map((p) => p.title.fr), ['Bienvenue', 'Arrivée', 'Le logement', 'Départ', 'Urgences et contacts']);
    assert.ok(seeded.every((p) => p.placeholder));
    await ctx.call('PUT', `${STUDIO}/pages/${seeded[0].id}`, { title: { fr: 'Bienvenue au domaine' } });
    assert.equal((await ctx.call('GET', `${STUDIO}/lodgings/1/booklet`)).body.pages[0].placeholder, false, 'edited → no longer a placeholder');
    await ctx.call('PUT', '/api/guest-app/lodgings/1', { enabled: false });
    seeded.forEach((p) => require('../models/bookletModel')(db).deletePage(p.id));
    await ctx.call('PUT', '/api/guest-app/lodgings/1', { enabled: true });
    assert.equal((await ctx.call('GET', `${STUDIO}/lodgings/1/booklet`)).body.pages.length, 0, 'a booklet that held pages is never seeded again');
  } finally {
    await ctx.close();
  }
});
