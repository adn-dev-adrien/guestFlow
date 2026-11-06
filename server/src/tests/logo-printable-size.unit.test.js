// specs/settings.md rule 8 (audit R24 combined verification, 2026-11-05): the logo the devis PDF reads is turned upright
// from its EXIF orientation and holds at most 1200 px a side; a small logo keeps its size.
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { printableLogo } = require('../utils/logoImage');

test('rule 8 — a huge logo is cut down to 1200 px a side for the PDF', async () => {
  const huge = await sharp({ create: { width: 4000, height: 2000, channels: 4, background: { r: 40, g: 90, b: 70, alpha: 1 } } }).png().toBuffer();
  const out = await printableLogo(huge);
  const meta = await sharp(out.bytes).metadata();
  assert.equal(out.ext, '.png');
  assert.deepEqual([meta.width, meta.height], [1200, 600]);
});

test('rule 8 — a small logo keeps its size', async () => {
  const small = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#2F5D46' } }).jpeg().toBuffer();
  const meta = await sharp((await printableLogo(small)).bytes).metadata();
  assert.deepEqual([meta.width, meta.height], [80, 40]);
});

test('rule 8 — a JPEG with EXIF orientation 6 is turned upright', async () => {
  const sideways = await sharp({ create: { width: 60, height: 20, channels: 3, background: '#2F5D46' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const out = await printableLogo(sideways);
  const meta = await sharp(out.bytes).metadata();
  assert.equal(out.ext, '.jpg');
  assert.deepEqual([meta.width, meta.height], [20, 60]);
  assert.ok(!meta.orientation || meta.orientation === 1);
});
