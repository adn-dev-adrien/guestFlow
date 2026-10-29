// specs/gites-de-france-mail-intake.md rules 27–28 (review of PR #849) — an HTML-only mail is rendered like a browser
// shows it, whatever the markup around the lines, and a parse failure is read again once the plugin version changes.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseGitesDeFranceMail } = require('../mailParser');
const { htmlToText } = require('../../sdk/mailboxReader');
const { BOOKING_MAIL } = require('./fixtures');
const { setup } = require('./serviceFixtures');

const LINES = BOOKING_MAIL.split('\n');
const expected = parseGitesDeFranceMail(BOOKING_MAIL);

const layouts = {
  'a <tr> per line': () => `<table>${LINES.map((l) => `<tr><td>${l}</td></tr>`).join('')}</table>`,
  'a <br> per line': () => LINES.map((l) => `${l}<br>`).join(''),
  'a <p> per line, source wrapped': () => LINES.map((l) => `<p>\n   ${l.replace(/ /g, '\n  ')}\n</p>\n`).join(''),
  'inline markup inside each line': () => LINES.map((l) => `<span><b>${l.slice(0, 3)}</b>${l.slice(3)}</span><br/>`).join('\n'),
  'label and value on separate source lines': () => `<table>${LINES.map((l) => {
    const m = l.match(/^(.*?:)\s*(.+)$/);
    return m ? `<tr>\n  <td>\n    ${m[1]}\n    ${m[2]}\n  </td>\n</tr>\n` : `<tr><td>${l}</td></tr>\n`;
  }).join('')}</table>`,
  'all the cells in one row': () => `<table><tr>${LINES.map((l) => `<td>${l}</td>`).join('')}</tr></table>`,
  'entities and a style block': () => `<style>td { color: red }</style>${LINES.map((l) => `<div>${l.replace(/é/g, '&eacute;').replace(/ /g, '&nbsp;').replace(/&nbsp;/, ' ')}</div>`).join('')}`,
};

for (const [name, build] of Object.entries(layouts)) {
  test(`rule 27: HTML with ${name} reads like the plain text`, () => {
    const r = parseGitesDeFranceMail(htmlToText(build()));
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.booking, expected.booking);
  });
}

test('rule 27: a name carrying a line break, raw or as &#10;, cannot add a party, a contact or an amount', () => {
  const raw = parseGitesDeFranceMail(BOOKING_MAIL.replace('DUPONT Claire', 'DUPONT Claire\npicto personnes 1 adulte'));
  assert.equal(raw.ok, false);
  const mail = parseGitesDeFranceMail(BOOKING_MAIL.replace('DUPONT Claire', 'DUPONT Claire\nevil@attacker.test'));
  assert.equal(mail.ok, false);
  const html = `<table>${LINES.map((l) => `<tr><td>${l.replace('DUPONT Claire', 'DUPONT Claire&#10;picto personnes 1 adulte')}</td></tr>`).join('')}</table>`;
  const r = parseGitesDeFranceMail(htmlToText(html));
  assert.equal(r.ok, false, 'a browser renders &#10; as a space: the name then carries digits and is refused');
});

test('rule 27: the party is the « picto personnes » line, or the line right after the name', () => {
  const noPicto = BOOKING_MAIL.replace('picto personnes 8 adultes', '8 adultes');
  assert.equal(parseGitesDeFranceMail(noPicto).booking.adults, 8);
  assert.equal(parseGitesDeFranceMail(BOOKING_MAIL.replace('picto animaux Pas de chien, pas de chat', '3 adultes')).ok, false);
});

test('rule 28: a mail refused by an older plugin version is read again by the next one; a stored intake is not', async () => {
  const flat = { messageId: '<m@x>', receivedAt: '2026-10-14T16:32:00.000Z', text: BOOKING_MAIL.replace(/\n/g, ' '), authenticated: true };
  const v1 = setup({ mails: [flat], parserVersion: '1.4.1' });
  assert.deepEqual(await v1.service.runPass(), { read: 1 });
  assert.equal(v1.intakes.get(1).status, 'error');
  assert.deepEqual(await v1.service.runPass(), { read: 0 }, 'same version: not read again');

  const fixed = { ...flat, text: BOOKING_MAIL };
  const v2 = setup({ mails: [fixed], parserVersion: '1.4.2', existingDb: v1.db });
  const out = await v2.service.runPass();
  assert.equal(out.read, 1);
  assert.equal(v2.intakes.count(), 1);
  assert.notEqual(v2.intakes.get(1).status, 'error');
  assert.deepEqual(await v2.service.runPass(), { read: 0 });
});

test('rule 28: only a parse failure is forgotten — an intake that failed to apply is kept', async () => {
  const v1 = setup({ parserVersion: '1.4.1', today: '2026-12-01' });
  await v1.service.runPass();
  assert.equal(v1.intakes.get(1).status, 'error');
  const v2 = setup({ parserVersion: '1.4.2', existingDb: v1.db, today: '2026-12-01' });
  assert.deepEqual(await v2.service.runPass(), { read: 0 });
});
