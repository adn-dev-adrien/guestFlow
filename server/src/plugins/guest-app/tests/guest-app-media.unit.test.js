// specs/guest-app.md §5, rule 48 — a studio photo: its type and size judged at the boundary, the decoded format
// deciding over the declared one, stored as 1600 / 800 / 400 px WebP (never enlarged) under the uploads' guest-app
// folder, served at `/uploads/<path>`, with its FR / EN alt text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const { enable, freshDb, startApi } = require('./guestAppFixtures');
const { MAX_UPLOAD_BYTES } = require('../media');

const MEDIA = '/api/guest-app/studio/media';

const image = (width, height, format = 'png') => sharp({
  create: { width, height, channels: 3, background: { r: 40, g: 90, b: 60 } },
})[format]().toBuffer();

async function withMedia(fn) {
  const db = freshDb();
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-guest-media-'));
  const ctx = await startApi(db, { uploadsDir });
  const upload = async (buffer, { type = 'image/png', name = 'photo.png', fields = {} } = {}) => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type }), name);
    Object.entries(fields).forEach(([key, value]) => form.append(key, value));
    const res = await fetch(`${ctx.base}${MEDIA}`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn({
      db, ctx, upload, uploadsDir,
    });
  } finally {
    await ctx.close();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }
}

test('§5: a photo is stored at 1600, 800 and 400 px in WebP, served under /uploads, with its alt texts', () => withMedia(async ({ upload, uploadsDir }) => {
  const res = await upload(await image(3000, 2000, 'jpeg'), { type: 'image/jpeg', name: 'terrasse.jpg', fields: { altFr: 'La terrasse', altEn: 'The terrace' } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.match(res.body.url, /^\/uploads\/guest-app\/[0-9a-f]{24}\.webp$/);
  assert.deepEqual(Object.keys(res.body.sizes), ['400', '800', '1600']);
  assert.equal(res.body.url, res.body.sizes[1600]);
  assert.deepEqual([res.body.width, res.body.height], [1600, 1067]);
  assert.deepEqual([res.body.altFr, res.body.altEn], ['La terrasse', 'The terrace']);
  for (const [width, url] of Object.entries(res.body.sizes)) {
    const file = path.join(uploadsDir, url.replace(/^\/uploads\//, ''));
    // eslint-disable-next-line no-await-in-loop
    const meta = await sharp(file).metadata();
    assert.equal(meta.format, 'webp', width);
    assert.equal(meta.width, Number(width), width);
  }
}));

test('§5: a small photo is never enlarged', () => withMedia(async ({ upload, uploadsDir }) => {
  const res = await upload(await image(600, 300));
  assert.equal(res.status, 201);
  assert.deepEqual([res.body.width, res.body.height], [600, 300]);
  const widths = await Promise.all(Object.values(res.body.sizes).map(async (url) => (await sharp(path.join(uploadsDir, url.slice('/uploads/'.length))).metadata()).width));
  assert.deepEqual(widths, [400, 600, 600]);
}));

test('rule 48: the type, the content and the size are refused at the boundary', () => withMedia(async ({ upload, uploadsDir }) => {
  assert.equal(MAX_UPLOAD_BYTES, 10 * 1024 * 1024);
  const cases = [
    ['a declared type outside the list', await image(10, 10), { type: 'image/svg+xml', name: 'x.svg' }],
    ['text that claims to be a PNG', Buffer.from('not an image'), {}],
    ['a GIF declared as a PNG', await image(10, 10, 'gif'), {}],
    ['over 10 MB', Buffer.alloc(MAX_UPLOAD_BYTES + 1), {}],
    ['an alt text over 200 characters', await image(10, 10), { fields: { altFr: 'x'.repeat(201) } }],
  ];
  for (const [label, buffer, options] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const res = await upload(buffer, options);
    assert.equal(res.status, 400, label);
    assert.equal(typeof res.body.error, 'string', label);
  }
  assert.deepEqual(fs.existsSync(path.join(uploadsDir, 'guest-app')) ? fs.readdirSync(path.join(uploadsDir, 'guest-app')) : [], [], 'nothing written');
}));

test('rule 48: the alt texts are edited apart, the library lists the photos', () => withMedia(async ({ ctx, upload }) => {
  const { body } = await upload(await image(40, 40), { fields: { altFr: 'Le pré' } });
  const edited = await ctx.call('PUT', `${MEDIA}/${body.id}`, { altEn: 'The meadow' });
  assert.deepEqual([edited.body.altFr, edited.body.altEn], ['Le pré', 'The meadow']);
  assert.equal((await ctx.call('PUT', `${MEDIA}/${body.id}`, { altFr: 3 })).status, 400);
  assert.equal((await ctx.call('PUT', `${MEDIA}/${body.id}`, { caption: 'x' })).status, 400);
  assert.equal((await ctx.call('PUT', `${MEDIA}/999`, { altFr: 'x' })).status, 404);
  assert.deepEqual((await ctx.call('GET', MEDIA)).body.map((m) => m.id), [body.id]);
}));

test('rules 16, 18: a page cover and an image block show the photo in the guest\'s language', () => withMedia(async ({ db, ctx, upload }) => {
  const { body: photo } = await upload(await image(40, 40), { fields: { altFr: 'Le pré', altEn: 'The meadow' } });
  const code = enable(ctx.api, db);
  const studio = '/api/guest-app/studio';
  assert.equal((await ctx.call('POST', `${studio}/lodgings/1/pages`, { slug: 'pre', title: { fr: 'Le pré' }, coverMediaId: 999 })).status, 400, 'an unknown cover');
  const page = (await ctx.call('POST', `${studio}/lodgings/1/pages`, { slug: 'pre', title: { fr: 'Le pré' }, coverMediaId: photo.id })).body;
  await ctx.call('POST', `${studio}/pages/${page.id}/blocks`, { type: 'image', data: { mediaId: photo.id } });
  await ctx.call('POST', `${studio}/lodgings/1/publish`);
  const read = (await ctx.call('GET', `/public/v1/guest/booklet/pages/pre?lang=en&lodgingCode=${code}`, undefined, { cookie: null })).body.data;
  assert.equal(read.cover.url, photo.url);
  assert.equal(read.cover.alt, 'The meadow');
  assert.deepEqual(read.blocks[0].image.sizes, photo.sizes);
}));
