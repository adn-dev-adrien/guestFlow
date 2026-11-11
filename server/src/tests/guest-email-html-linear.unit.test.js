// Audit 2026-10-28 (injection finding 3) — the trailing-punctuation trim of a link is linear, and keeps
// its rules: sentence punctuation leaves the address, a parenthesis that closes one opened inside stays.
const test = require('node:test');
const assert = require('node:assert/strict');

const { renderGuestEmailHtml } = require('../utils/guestEmailHtml');

test('a link followed by 40 000 closing parentheses renders in bounded time', () => {
  const started = Date.now();
  renderGuestEmailHtml({ text: `Voir https://x${')'.repeat(40000)}`, subject: 's' });
  assert.ok(Date.now() - started < 1000);
});

test('sentence punctuation leaves the address, a balanced parenthesis stays', () => {
  const html = renderGuestEmailHtml({ text: 'Voir https://fr.wikipedia.org/wiki/Foo_(bar). Merci (https://x.fr/a).', subject: 's' });
  const html2 = typeof html === 'string' ? html : html.html;
  assert.match(html2, /href="https:\/\/fr\.wikipedia\.org\/wiki\/Foo_\(bar\)"[^>]*>https:\/\/fr\.wikipedia\.org\/wiki\/Foo_\(bar\)<\/a>\./);
  assert.match(html2, /href="https:\/\/x\.fr\/a"[^>]*>https:\/\/x\.fr\/a<\/a>\)\./);
});
