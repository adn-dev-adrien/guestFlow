// specs/guest-app.md rules 70, 89 (amended 2026-11-10, third message), specs/guest-email-sequence.md rule 38 — the J-7 paragraph the operator script adds to the stored template: the
// link and what the guests can already do, no app name, nothing about paying, the bath sentence only when the server says the stay has
// a bath to schedule. Rendered with the core's own renderer on the default J-7 template, in French and English.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { renderTemplate } = require('../../../utils/emailTemplateRenderer');
const { FLAGS, TOKENS, stayAppEmailContext } = require('../emailContext');
const sequence = require('../../../utils/guestEmailSequenceTemplates');

const SCRIPT = pathToFileURL(path.join(__dirname, '..', '..', '..', '..', '..', 'specs', 'guest-app-livret', 'import.mjs')).href;
const URL_OF_STAY = 'https://sejour.example.test/s/abc';

const j7 = () => ({ body: sequence.J7_BODY, bodyEn: sequence.J7_BODY_EN });

async function withParagraph() {
  const { withStayAppParagraph, EMAILS } = await import(SCRIPT);
  const email = EMAILS.find((e) => e.key === 'arrival_reminder_7d');
  const template = j7();
  return { next: withStayAppParagraph(template, email), template };
}

const render = (body, ctx) => renderTemplate({ subject: '', body }, { vars: { stayAppUrl: ctx.tokens.stayAppUrl, clientFirstName: 'Marie' }, flags: ctx.flags }).body;
const ctxOf = (shop, bath) => stayAppEmailContext({ stayUrl: URL_OF_STAY, gateUrl: null, shop, bath });

test('rule 70: the J-7 paragraph sits just before « Une question » / « Any question », and only when the template does not carry the link yet', async () => {
  const { next, template } = await withParagraph();
  assert.ok(next.body.indexOf('{{stayAppUrl}}') < next.body.indexOf('Une question'));
  assert.ok(next.bodyEn.indexOf('{{stayAppUrl}}') < next.bodyEn.indexOf('Any question'));
  assert.equal(next.body.replace(/\{\{#if hasStayApp(Bath|ShopOnly)\}\}[\s\S]*?\{\{\/if\}\}/g, ''), template.body, 'nothing else moved');
  const { withStayAppParagraph, EMAILS } = await import(SCRIPT);
  assert.equal(withStayAppParagraph({ body: next.body, bodyEn: next.bodyEn }, EMAILS[0]), null, 'a body already holding the link is left alone');
  assert.throws(() => withStayAppParagraph({ body: 'Bonjour', bodyEn: 'Hello' }, EMAILS[0]), /ajoutez le paragraphe à la main|Ajoutez le paragraphe à la main/);
});

test('rule 70: the stay holds the bath (booked or offered) — one sentence with the bath, then the link; no payment word, no app name', async () => {
  const { next } = await withParagraph();
  const fr = render(next.body, ctxOf(true, true));
  assert.match(fr, new RegExp(`Vous pouvez déjà commander ce que vous aimeriez trouver à votre arrivée, et programmer votre séance de bain nordique : ${URL_OF_STAY.replace(/[.]/g, '\\.')}`));
  const en = render(next.bodyEn, ctxOf(true, true));
  assert.match(en, /You can already order anything you would like to find on arrival, and book your nordic bath session: https:/);
  for (const text of [fr, en]) {
    assert.doesNotMatch(text, /régl|pay|payer|règlement|bill|note|Mon séjour|\{\{|\}\}/i);
    assert.equal((text.match(/https:/g) || []).length, 1, 'one link');
  }
});

test('rule 70: no bath to schedule — the bath clause never appears (no dead promise)', async () => {
  const { next } = await withParagraph();
  const fr = render(next.body, ctxOf(true, false));
  assert.match(fr, /Vous pouvez déjà commander ce que vous aimeriez trouver à votre arrivée : https:/);
  assert.doesNotMatch(fr, /bain/i);
  assert.doesNotMatch(render(next.bodyEn, ctxOf(true, false)), /bath/i);
});

test('rule 70: no shop, or no link of the app\'s own — the paragraph renders nothing at all', async () => {
  const { next, template } = await withParagraph();
  assert.equal(render(next.body, ctxOf(false, true)), render(template.body, ctxOf(false, true)));
  const gate = stayAppEmailContext({ stayUrl: '', gateUrl: 'https://gate.example.test/k', shop: true, bath: true });
  assert.equal(render(next.body, gate), render(template.body, gate), 'never the gate link under the app\'s words');
});

test('rule 70: the plugin declares the flags the template hangs on, for the J-7 and the J-2, and the token', () => {
  assert.deepEqual(FLAGS.map((f) => f.name), ['hasStayApp', 'hasStayAppShop', 'hasStayAppBath', 'hasStayAppShopOnly']);
  assert.ok(FLAGS.every((f) => f.in.includes('j7') && f.in.includes('j2')));
  assert.equal(TOKENS[0].name, 'stayAppUrl');
});

test('rule 70: the script writes `body` and `bodyEn` only — never a subject, `enabled` or `sendMode` (no automatic e-mail)', async () => {
  const { next } = await withParagraph();
  assert.deepEqual(Object.keys(next).sort(), ['body', 'bodyEn']);
});
