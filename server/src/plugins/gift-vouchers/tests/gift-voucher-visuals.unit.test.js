// specs/gift-voucher-campaigns.md rules 47-48 — the visual library: a JPEG or PNG in the A6 portrait ratio of at least 1240 × 1748 px, refused with its measured size,
// stored as received; renamed; replaced by a new version; deleted unless an on-sale campaign uses it; a voucher keeps the version it was issued with, and a version file
// is purged once no valid voucher carries it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const fx = require('./giftVoucherFixtures');
const { filesDir } = require('./visualFilesFixture');
const { picture, sendForm, addVisual } = require('./visualFixtures');

async function withLibrary(fn) {
  const fixture = fx.buildApi();
  const server = await fx.start(fixture);
  try {
    await fn({ ...fixture, server });
  } finally {
    await server.close();
  }
}

const ROUTE = '/api/gift-vouchers/visuals';
const REFUSAL = (w, h) => `Image trop petite ou mal proportionnée : ${w} × ${h} px. Il faut au moins 1240 × 1748 px, format A6 portrait.`;

test('rule 47: a JPEG or a PNG of at least 1240 × 1748 px in the A6 ratio is accepted and stored exactly as received', () => withLibrary(async ({ server }) => {
  const jpeg = await picture(1240, 1748);
  const created = await sendForm(server, 'POST', ROUTE, { fields: { name: 'Façade', use: 'voucher' }, file: jpeg });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual([created.body.name, created.body.use, created.body.width, created.body.height, created.body.versions], ['Façade', 'voucher', 1240, 1748, 1]);
  const png = await picture(1300, 1832, { format: 'png' });
  assert.equal((await sendForm(server, 'POST', ROUTE, { fields: { name: 'Plan', use: 'merchant' }, file: png, filename: 'plan.png', type: 'image/png' })).status, 201);
  const stored = fs.readdirSync(filesDir()).filter((f) => /\.(jpg|png)$/.test(f));
  assert.ok(stored.some((f) => fs.readFileSync(path.join(filesDir(), f)).equals(jpeg)), 'the JPEG is on disk byte for byte');
  assert.ok(stored.some((f) => fs.readFileSync(path.join(filesDir(), f)).equals(png)), 'the PNG too');
}));

test('rule 47: too small, misshapen, not an image, a GIF or no file is refused with the measured size, and nothing is stored', () => withLibrary(async ({ server, db }) => {
  const send = (file, extra = {}) => sendForm(server, 'POST', ROUTE, { fields: { name: 'X', use: 'both' }, file, ...extra });
  const small = await send(await picture(1239, 1748));
  assert.deepEqual([small.status, small.body.error, small.body.code], [422, REFUSAL(1239, 1748), 'IMAGE_REFUSED']);
  assert.equal((await send(await picture(1240, 1747))).body.error, REFUSAL(1240, 1747));
  assert.equal((await send(await picture(1748, 1240))).body.error, REFUSAL(1748, 1240), 'landscape');
  assert.equal((await send(await picture(2480, 2480))).body.error, REFUSAL(2480, 2480), 'square');
  assert.equal((await send(await picture(1300, 1832 + 60))).body.error, REFUSAL(1300, 1892), 'beyond 2 % of the ratio');
  assert.equal((await send(await picture(1300, 1832 + 20))).status, 201, 'within 2 % of the ratio');
  assert.equal((await send(Buffer.from('not an image'))).body.error, 'Ce fichier n’est pas une image lisible.');
  const gif = await require('sharp')({ create: { width: 1300, height: 1832, channels: 3, background: '#fff' } }).gif().toBuffer();
  assert.equal((await send(gif, { filename: 'a.gif', type: 'image/gif' })).body.error, 'Formats acceptés : JPEG ou PNG.');
  assert.equal((await sendForm(server, 'POST', ROUTE, { fields: { name: 'X', use: 'both' } })).body.error, 'Une image est attendue.');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gift_voucher_visuals').get().n, 1, 'only the accepted one');
}));

test('rule 47: the name and the use are judged; an unknown visual is a 404; the list carries the thumbnail route data', () => withLibrary(async ({ server }) => {
  const file = await picture();
  for (const fields of [{ name: '', use: 'both' }, { name: 'x'.repeat(81), use: 'both' }, { name: 'X', use: 'poster' }, { name: 'X' }]) {
    assert.equal((await sendForm(server, 'POST', ROUTE, { fields, file })).status, 422, JSON.stringify(fields));
  }
  const visual = await addVisual(server, { name: 'Bleu', use: 'voucher' });
  const list = (await server.call('GET', ROUTE)).body.items;
  assert.deepEqual(list.map((v) => [v.id, v.name, v.use, v.campaigns, v.validVouchers]), [[visual.id, 'Bleu', 'voucher', [], 0]]);
  assert.equal((await server.call('GET', `${ROUTE}/999`)).status, 404);
  const thumb = await server.call('GET', `${ROUTE}/${visual.id}/image`);
  assert.deepEqual([thumb.status, thumb.headers.get('content-type')], [200, 'image/jpeg']);
  assert.equal((await require('sharp')(thumb.body).metadata()).width, 480, 'a thumbnail');
  const full = await server.call('GET', `${ROUTE}/${visual.id}/image?full=1`);
  assert.equal((await require('sharp')(full.body).metadata()).width, 1300, 'the file as uploaded on demand');
}));

test('rule 47: renaming changes the name and the use; replacing the image makes a new version and keeps the first', () => withLibrary(async ({ server, db }) => {
  const visual = await addVisual(server, { name: 'Bleu', use: 'voucher' });
  const renamed = await sendForm(server, 'PUT', `${ROUTE}/${visual.id}`, { fields: { name: 'Bleu nuit', use: 'both' } });
  assert.deepEqual([renamed.status, renamed.body.name, renamed.body.use, renamed.body.versions], [200, 'Bleu nuit', 'both', 1]);
  const replaced = await sendForm(server, 'PUT', `${ROUTE}/${visual.id}`, { file: await picture(1400, 1974, { background: '#aa0000' }) });
  assert.deepEqual([replaced.status, replaced.body.name, replaced.body.width, replaced.body.versions], [200, 'Bleu nuit', 1400, 2]);
  assert.equal((await sendForm(server, 'PUT', `${ROUTE}/${visual.id}`, { file: await picture(500, 700) })).status, 422);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gift_voucher_visual_versions WHERE purgedAt IS NULL').get().n, 2);
  assert.equal((await sendForm(server, 'PUT', `${ROUTE}/999`, { fields: { name: 'X' } })).status, 404);
}));

test('rule 47: a visual used by an on-sale campaign cannot be deleted — the sentence names the campaign — nor turned to the other face; otherwise it leaves the library', () => withLibrary(async ({ server, api }) => {
  const visual = await addVisual(server, { name: 'Bleu', use: 'voucher' });
  const lodging = api.campaigns.firstLodging();
  api.campaigns.update(lodging.id, { ...lodging, voucherVisualId: visual.id });
  const refused = await server.call('DELETE', `${ROUTE}/${visual.id}`);
  assert.deepEqual([refused.status, refused.body.error, refused.body.code], [422, 'Utilisé par la campagne en vente « Bon cadeau séjour ». Retirez-le de la campagne d’abord.', 'VISUAL_IN_USE']);
  assert.equal((await sendForm(server, 'PUT', `${ROUTE}/${visual.id}`, { fields: { use: 'merchant' } })).body.code, 'VISUAL_IN_USE');
  assert.equal((await server.call('GET', ROUTE)).body.items[0].campaigns[0].name, 'Bon cadeau séjour');
  api.campaigns.update(lodging.id, { ...lodging, voucherVisualId: null, state: 'closed' });
  api.campaigns.update(lodging.id, { ...api.campaigns.find(lodging.id), voucherVisualId: visual.id });
  assert.equal((await server.call('DELETE', `${ROUTE}/${visual.id}`)).status, 204, 'a closed campaign no longer holds it');
  assert.deepEqual((await server.call('GET', ROUTE)).body.items, []);
  assert.equal((await server.call('DELETE', `${ROUTE}/${visual.id}`)).status, 404);
}));

test('rule 7: a campaign picks a front from the library — one that exists, not deleted, meant for that face', () => withLibrary(async ({ server }) => {
  const merchantOnly = await addVisual(server, { name: 'Commerçant', use: 'merchant' });
  const both = await addVisual(server, { name: 'Les deux', use: 'both' });
  const lodging = (await server.call('GET', '/api/gift-vouchers/campaigns')).body.items[0];
  const put = (body) => server.call('PUT', `/api/gift-vouchers/campaigns/${lodging.id}`, body);
  assert.equal((await put({ voucherVisualId: 999 })).body.errors[0].field, 'voucherVisualId');
  assert.equal((await put({ voucherVisualId: merchantOnly.id })).body.errors[0].message, 'Face du bon : « Commerçant » n’est pas prévu pour cette face.');
  const ok = await put({ voucherVisualId: both.id, merchantVisualId: merchantOnly.id });
  assert.deepEqual([ok.status, ok.body.voucherVisualId, ok.body.merchantVisualId], [200, both.id, merchantOnly.id]);
  await server.call('DELETE', `${ROUTE}/${both.id}`);
}));

async function issueWithFront(server, api, visualId) {
  const lodging = api.campaigns.firstLodging();
  api.campaigns.update(lodging.id, { ...lodging, voucherVisualId: visualId });
  return fx.issueManual(server);
}

test('rule 48: a voucher keeps the version it was issued with — replacing or deleting the visual never changes it', () => withLibrary(async ({ server, api, db }) => {
  const visual = await addVisual(server, { name: 'Bleu', use: 'voucher' });
  const first = visual.versionId;
  const v = await issueWithFront(server, api, visual.id);
  assert.deepEqual(JSON.parse(db.prepare('SELECT visualVersions FROM gift_vouchers WHERE id = ?').get(v.id).visualVersions), { voucher: first });
  const replaced = await sendForm(server, 'PUT', `${ROUTE}/${visual.id}`, { file: await picture(1400, 1974, { background: '#aa0000' }) });
  assert.notEqual(replaced.body.versionId, first);
  const w = await fx.issueManual(server);
  assert.equal(JSON.parse(db.prepare('SELECT visualVersions FROM gift_vouchers WHERE id = ?').get(w.id).visualVersions).voucher, replaced.body.versionId, 'a new voucher takes the new version');
  assert.equal(JSON.parse(db.prepare('SELECT visualVersions FROM gift_vouchers WHERE id = ?').get(v.id).visualVersions).voucher, first, 'the first keeps its own');
  assert.equal((await server.call('GET', `${ROUTE}/${visual.id}`)).body.validVouchers, 2);
}));

test('rule 48: a version file is kept while a valid voucher carries it, and purged once none does — the daily job', () => withLibrary(async ({ server, api, db, clock }) => {
  const visual = await addVisual(server, { name: 'Bleu', use: 'voucher' });
  const first = db.prepare('SELECT * FROM gift_voucher_visual_versions WHERE id = ?').get(visual.versionId);
  const v = await issueWithFront(server, api, visual.id);
  await sendForm(server, 'PUT', `${ROUTE}/${visual.id}`, { file: await picture(1400, 1974) });
  const onDisk = (version) => fs.existsSync(path.join(filesDir(), version.path));
  assert.equal(api.purgeVisuals(), 0, 'a valid voucher still carries the first version');
  assert.equal(onDisk(first), true);
  await server.call('POST', `/api/gift-vouchers/${v.id}/cancel`, {});
  assert.equal(api.purgeVisuals(), 1, 'a cancelled voucher needs nothing');
  assert.equal(onDisk(first), false);
  assert.ok(db.prepare('SELECT purgedAt FROM gift_voucher_visual_versions WHERE id = ?').get(first.id).purgedAt);
  const current = db.prepare('SELECT * FROM gift_voucher_visual_versions WHERE purgedAt IS NULL').get();
  assert.equal(onDisk(current), true, 'the current image of a visual in the library is never purged');
  assert.equal(api.purgeVisuals(), 0);

  const w = await fx.issueManual(server);
  const lodging = api.campaigns.firstLodging();
  api.campaigns.update(lodging.id, { ...lodging, voucherVisualId: null });
  await server.call('DELETE', `${ROUTE}/${visual.id}`);
  assert.equal(api.purgeVisuals(), 0, 'the deleted visual’s file stays while a valid voucher could still carry it');
  clock.at = new Date('2028-06-01T10:00:00Z');
  assert.equal(api.purgeVisuals(), 1, 'an expired voucher needs nothing either');
  assert.equal(onDisk(current), false);
  assert.ok(w.id);
}));
