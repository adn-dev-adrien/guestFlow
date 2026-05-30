const test = require('node:test');
const assert = require('node:assert/strict');

const { welcomeEmailBody, passwordResetEmailBody, testEmailBody } = require('../utils/emailTemplates');

// Pure functions returning { subject, text }. We assert the dynamic placeholders land in the body
// (email, temp password, public URL) and that subjects are non-empty + plain-text only.

const BASE = {
  firstName: 'Marie',
  lastName: 'Dupont',
  email: 'marie@example.org',
  temporaryPassword: 'Abc23xYzPQ4',
  publicUrl: 'https://guestflow.example.com',
};

function assertPlainTextSubject(subject) {
  assert.equal(typeof subject, 'string');
  assert.ok(subject.length > 0);
  assert.equal(/<\s*\w+/.test(subject), false, 'subject must not contain HTML tags');
}

function assertPlainTextBody(text) {
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0);
  // No <tags>. Allow `<email>`-style angle brackets if any (none expected here, but harmless).
  assert.equal(/<\s*(html|body|p|div|br|a|img)\b/i.test(text), false, 'body must be plain text');
}

test('welcomeEmailBody contains email, temp password and public URL verbatim', () => {
  const { subject, text } = welcomeEmailBody(BASE);
  assertPlainTextSubject(subject);
  assertPlainTextBody(text);
  assert.equal(subject, 'Votre accès GuestFlow');
  assert.ok(text.includes(BASE.email));
  assert.ok(text.includes(BASE.temporaryPassword));
  assert.ok(text.includes(BASE.publicUrl));
  // French greeting includes the recipient's full name.
  assert.ok(text.startsWith('Bonjour Marie Dupont,'));
});

test('welcomeEmailBody surfaces the optional company name when provided', () => {
  const { text } = welcomeEmailBody({ ...BASE, companyName: 'ACME SARL' });
  assert.ok(text.includes('Société associée : ACME SARL'));
});

test('welcomeEmailBody omits the company line when companyName is empty', () => {
  const { text } = welcomeEmailBody({ ...BASE, companyName: '' });
  assert.equal(text.includes('Société associée'), false);
});

test('passwordResetEmailBody mentions the reset context + same placeholders', () => {
  const { subject, text } = passwordResetEmailBody(BASE);
  assertPlainTextSubject(subject);
  assertPlainTextBody(text);
  assert.equal(subject, 'Réinitialisation de votre mot de passe');
  assert.ok(text.toLowerCase().includes('réinitialisé'));
  assert.ok(text.includes(BASE.email));
  assert.ok(text.includes(BASE.temporaryPassword));
  assert.ok(text.includes(BASE.publicUrl));
});

test('testEmailBody is plain text, non-empty', () => {
  const { subject, text } = testEmailBody();
  assertPlainTextSubject(subject);
  assertPlainTextBody(text);
  assert.equal(subject, 'Email de test GuestFlow');
});

test('falsy name pieces fall back to a generic French greeting', () => {
  const { text } = welcomeEmailBody({ ...BASE, firstName: '', lastName: '' });
  assert.ok(text.startsWith('Bonjour bonjour,'));
});

// Adrien feedback (2026-05-30): sign every email with the SMTP sender's display name and add the
// auto-generated notice so recipients know it's not personal correspondence.

test('welcomeEmailBody signs with fromName + carries the auto-generated notice', () => {
  const { text } = welcomeEmailBody({ ...BASE, fromName: 'Domaine Solio' });
  assert.ok(text.includes('Ce message est généré automatiquement.'));
  assert.ok(text.trimEnd().endsWith('— Domaine Solio'), 'signature uses the configured sender name');
  assert.equal(text.includes('— GuestFlow'), false, 'no leftover hardcoded GuestFlow signature');
});

test('passwordResetEmailBody signs with fromName + carries the auto-generated notice', () => {
  const { text } = passwordResetEmailBody({ ...BASE, fromName: 'Domaine Solio' });
  assert.ok(text.includes('Ce message est généré automatiquement.'));
  assert.ok(text.trimEnd().endsWith('— Domaine Solio'));
});

test('testEmailBody signs with fromName + carries the auto-generated notice', () => {
  const { testEmailBody } = require('../utils/emailTemplates');
  const { text } = testEmailBody({ fromName: 'Domaine Solio' });
  assert.ok(text.includes('Ce message est généré automatiquement.'));
  assert.ok(text.trimEnd().endsWith('— Domaine Solio'));
});

test('fromName missing or empty → falls back to "GuestFlow" so the email never ends with a dangling dash', () => {
  for (const arg of [undefined, '', '   ']) {
    const { text } = welcomeEmailBody({ ...BASE, fromName: arg });
    assert.ok(text.trimEnd().endsWith('— GuestFlow'), `fallback for fromName=${JSON.stringify(arg)}`);
  }
});
