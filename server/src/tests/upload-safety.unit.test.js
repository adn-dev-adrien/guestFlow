const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { isAllowedUpload, allowedExtension, safeUploadName, safeUploadPath } = require('../utils/uploadSafety');

test('isAllowedUpload: document accepts pdf with matching MIME', () => {
  assert.equal(isAllowedUpload('contract.pdf', 'application/pdf', 'document'), true);
  assert.equal(isAllowedUpload('photo.png', 'image/png', 'document'), true);
});

test('isAllowedUpload: rejects disallowed extension or mismatched MIME', () => {
  assert.equal(isAllowedUpload('evil.exe', 'application/octet-stream', 'document'), false);
  assert.equal(isAllowedUpload('shell.php', 'application/pdf', 'document'), false); // ext not allowed
  assert.equal(isAllowedUpload('contract.pdf', 'application/octet-stream', 'document'), false); // MIME mismatch
  assert.equal(isAllowedUpload('x.png', 'image/png', 'unknownKind'), false);
});

test('isAllowedUpload: image kind allows images only', () => {
  assert.equal(isAllowedUpload('logo.png', 'image/png', 'image'), true);
  assert.equal(isAllowedUpload('doc.pdf', 'application/pdf', 'image'), false);
});

test('allowedExtension returns whitelisted ext or fallback', () => {
  assert.equal(allowedExtension('logo.PNG', 'image', '.png'), '.png');
  assert.equal(allowedExtension('logo.svg', 'image', '.png'), '.png'); // not allowed → fallback
});

test('safeUploadName strips unsafe characters', () => {
  assert.equal(safeUploadName('my file (1).pdf'), 'my_file__1_.pdf');
  assert.equal(safeUploadName('../../etc/passwd'), 'passwd');
  assert.equal(safeUploadName(''), 'file');
});

test('safeUploadPath blocks traversal, keeps within uploads', () => {
  const dir = '/srv/app/uploads';
  const ok = safeUploadPath(dir, 'company-logo.png');
  assert.equal(ok, path.join(dir, 'company-logo.png'));
  // basename() neutralizes traversal; result stays inside uploads.
  const traversal = safeUploadPath(dir, '../../etc/passwd');
  assert.equal(traversal, path.join(dir, 'passwd'));
  assert.ok(traversal.startsWith(dir + path.sep));
});
