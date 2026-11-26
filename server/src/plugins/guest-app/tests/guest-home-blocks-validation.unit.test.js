// specs/guest-app/guest-app-home-automation.md rules 14, 28, 29 — what Studio may save: every refusal, all at once, by field.
const test = require('node:test');
const assert = require('node:assert/strict');

const { validateHomeBlocks } = require('../homeBlocksValidation');
const { CATALOG, GRANJA_BLOCKS } = require('./homeFixtures');

const withBlock = (kind, patch) => GRANJA_BLOCKS.map((b) => (b.kind === kind ? { ...b, ...patch } : b));
const errorsOf = (blocks) => validateHomeBlocks(blocks, CATALOG).errors || {};
const indexOf = (kind) => GRANJA_BLOCKS.findIndex((b) => b.kind === kind);

test('the Granja configuration is accepted, every list item gets a stable id', () => {
  const result = validateHomeBlocks(GRANJA_BLOCKS, CATALOG);
  assert.equal(result.ok, true);
  const lights = result.blocks.find((b) => b.kind === 'lights');
  assert.ok(lights.items.every((i) => /^[a-z0-9]{6,16}$/.test(i.id)));
  const again = validateHomeBlocks(result.blocks, CATALOG);
  assert.deepEqual(again.blocks.find((b) => b.kind === 'lights').items.map((i) => i.id), lights.items.map((i) => i.id));
});

test('the six kinds, each once', () => {
  assert.equal(validateHomeBlocks(GRANJA_BLOCKS.slice(1), CATALOG).ok, false);
  assert.equal(validateHomeBlocks([...GRANJA_BLOCKS.slice(1), GRANJA_BLOCKS[1]], CATALOG).ok, false);
});

test('a label is 1 to 24 characters', () => {
  const rooms = indexOf('rooms');
  const errors = errorsOf(withBlock('rooms', { items: [{ label: '  ', equipmentId: 't-sejour' }, { label: 'Une très très longue chambre du fond', equipmentId: 't-ch1' }] }));
  assert.equal(errors[`blocks.${rooms}.items.0.label`], 'Nom requis.');
  assert.equal(errors[`blocks.${rooms}.items.1.label`], 'Trop long : 36 caractères sur 24.');
});

test('8 rooms and 6 lights at most', () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({ label: `Pièce ${i}`, equipmentId: 't-sejour' }));
  assert.equal(errorsOf(withBlock('rooms', { items: nine }))[`blocks.${indexOf('rooms')}.items`], '8 pièces au plus.');
  const seven = Array.from({ length: 7 }, (_, i) => ({ label: `Lumière ${i}`, equipmentId: 'l-chene' }));
  assert.equal(errorsOf(withBlock('lights', { items: seven }))[`blocks.${indexOf('lights')}.items`], '6 lumières au plus.');
});

test('the same equipment twice in a list is refused', () => {
  const errors = errorsOf(withBlock('rooms', { items: [{ label: 'A', equipmentId: 't-sejour' }, { label: 'B', equipmentId: 't-sejour' }] }));
  assert.equal(errors[`blocks.${indexOf('rooms')}.items.1.equipmentId`], 'Déjà utilisé dans cette liste.');
});

test('« Pilotable » only on a light entrusted to guests in Sowel', () => {
  const errors = errorsOf(withBlock('lights', { items: [{ label: 'Salon', equipmentId: 'l-salon', pilotable: true }] }));
  assert.equal(errors[`blocks.${indexOf('lights')}.items.0.pilotable`], 'Non confiée aux voyageurs dans Sowel.');
});

test('an equipment that cannot fill the block is refused', () => {
  assert.equal(errorsOf(withBlock('energy', { equipmentId: 'wx' }))[`blocks.${indexOf('energy')}.equipmentId`], 'Équipement qui ne convient pas à ce bloc.');
  const lights = errorsOf(withBlock('lights', { items: [{ label: 'Météo', equipmentId: 'wx' }] }));
  assert.equal(lights[`blocks.${indexOf('lights')}.items.0.equipmentId`], 'Équipement qui ne convient pas à ce bloc.');
});

test('a block switched on with no equipment, or with an empty list, is refused; switched off it may stay empty', () => {
  assert.equal(errorsOf(withBlock('rain', { equipmentId: null }))[`blocks.${indexOf('rain')}.equipmentId`], 'Choisir un équipement.');
  assert.equal(errorsOf(withBlock('rooms', { items: [] }))[`blocks.${indexOf('rooms')}.items`], 'Ajouter au moins une pièce, ou couper le bloc.');
  assert.equal(validateHomeBlocks(withBlock('rain', { on: false, equipmentId: null }), CATALOG).ok, true);
});

test('every refusal comes back at once', () => {
  const blocks = withBlock('rooms', { items: [{ label: '', equipmentId: '' }] }).map((b) => (b.kind === 'rain' ? { ...b, equipmentId: null } : b));
  assert.equal(Object.keys(errorsOf(blocks)).length, 3);
});

test('rule 14 — an item that is not an object is refused field by field, never a crash', () => {
  const at = GRANJA_BLOCKS.findIndex((b) => b.kind === 'lights');
  const blocks = GRANJA_BLOCKS.map((b, i) => (i === at ? { ...b, items: [null] } : b));
  let n = 0;
  const result = validateHomeBlocks(blocks, CATALOG, () => `item${String(n += 1).padStart(2, '0')}`);
  assert.equal(result.ok, false);
  assert.ok(Object.keys(result.errors).some((k) => k.startsWith(`blocks.${at}.items.0`)));
});

test('rule 29 — « Réseau » takes the main meter only; switched on it needs one', () => {
  assert.equal(errorsOf(withBlock('grid', { equipmentId: 'm-granja' }))[`blocks.${indexOf('grid')}.equipmentId`], 'Équipement qui ne convient pas à ce bloc.');
  assert.equal(errorsOf(withBlock('grid', { equipmentId: null }))[`blocks.${indexOf('grid')}.equipmentId`], 'Choisir un équipement.');
  assert.equal(validateHomeBlocks(withBlock('grid', { on: false, equipmentId: null }), CATALOG).ok, true);
});

test('rule 28 — a plain thermometer may fill « Extérieur »', () => {
  assert.equal(validateHomeBlocks(withBlock('outdoor', { equipmentId: 't-ch1' }), CATALOG).ok, true);
});
