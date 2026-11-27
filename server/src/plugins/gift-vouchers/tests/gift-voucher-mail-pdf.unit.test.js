// specs/gift-vouchers/gift-voucher-campaigns.md rules 20, 21, 33, 34, 48, 49, 50 — the mail (the code, the contents, an invoice-style recap read from what was frozen, the PDF attached), the
// voucher's PDF (A6 two-sided, no amount on a bath, the back read from the campaign and the settings, the front frozen at issue), the merchant card (code box, no number, slug
// locked once downloaded), the legal mention and the website on both backs, and « Télécharger » / « Renvoyer » for a voucher still usable only.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { requirePlugins } = require('../../sdk/testing');

if (!requirePlugins(['hourly-resources'])) return;

const fx = require('./campaignFixtures');
const campaignRules = require('../campaignRules');
const images = require('../visualImages');
const code = require('../code');
const { LEGAL_MENTION, CODE_BOX_HEIGHT } = require('../voucherPdf');
const { picture } = require('./visualFixtures');
const { filesDir } = require('./visualFilesFixture');

const MM = 72 / 25.4;
const mm = (n) => n * MM;
const ids = fx.seedCatalogue();
const shop = fx.openShop();
const { api, db, sent } = shop;
const checked = campaignRules.validateCampaign(fx.bathCampaign(ids), fx.rulesContext(api));
const bath = api.campaigns.find(api.campaigns.insert(checked.value));
const parties = {
  recipientFirstName: 'Marie', recipientLastName: 'Durand', senderName: 'Paul', message: 'Joyeux anniversaire', email: 'paul@example.test', language: 'fr',
};

const sell = (request = { slug: bath.slug }, over = {}) => {
  const issued = api.offerService.issueDirect({
    request, parties: { ...parties, ...over.parties }, outcome: over.outcome || 'paid', paymentMethod: 'card', actor: 'user:7',
  });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  return api.vouchers.find(issued.voucherId);
};
const plainCode = (voucher) => require('../../sdk').coreModule('encryption').safeDecrypt(voucher.codeEncrypted).value;

/** Runs `run` while recording what is drawn: the texts with their place, the rounded rectangles, the rotations and the images. */
async function recorded(run) {
  const calls = { text: [], roundedRect: [], rotate: [], image: [] };
  const original = {};
  ['text', 'roundedRect', 'rotate', 'image'].forEach((name) => {
    original[name] = PDFDocument.prototype[name];
    PDFDocument.prototype[name] = function recordedCall(...args) {
      calls[name].push(args);
      return original[name].apply(this, args);
    };
  });
  try {
    const result = await run();
    return { result, calls, texts: calls.text.map(([str]) => String(str)) };
  } finally {
    Object.entries(original).forEach(([name, fn]) => { PDFDocument.prototype[name] = fn; });
  }
}

const SAFE = {
  left: mm(8), top: mm(8), right: mm(111) - mm(8), bottom: mm(146),
};
/** A line is said when drawn whole or when its wrapped pieces read it. */
const says = (texts, line) => texts.includes(line) || texts.join(' ').includes(line);
const pages = (buffer) => (buffer.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;

/** The texts of the back that are drawn horizontally must sit inside the safe area: no text under the trim, none in the bleed. */
function assertInsideSafeArea(calls, slug = 0) {
  calls.text.filter(([str]) => str !== LEGAL_MENTION).forEach(([str, x, y, options]) => {
    if (typeof x !== 'number') return;
    const width = options && options.width ? options.width : 0;
    assert.ok(x >= SAFE.left + slug - 0.01 && x + width <= SAFE.right + slug + 0.01, `« ${str} » stays between the side margins (x ${x}, width ${width})`);
    assert.ok(y >= SAFE.top + slug - 0.01 && y <= SAFE.bottom + slug - mm(3), `« ${str} » stays between the top and the foot margins (y ${y})`);
  });
}

test('rule 21: a bath voucher’s back reads the campaign and the settings — the contents frozen, the parties, the code, the validity, the company — and shows NO amount', async () => {
  const voucher = sell({ slug: bath.slug, extraMinutes: 60, addOns: [{ articleRef: `option:${ids.drink}`, qty: 2 }] });
  const seen = [];
  const { result, texts, calls } = await recorded(() => api.documents.voucherPdf(voucher, { qr: (url) => { seen.push(url); return require('qrcode').create(url).modules; } }));
  assert.equal(pages(result), 2);
  assert.match(result.toString('latin1'), /\/MediaBox \[0 0 314\.64\d* 436\.53\d*\]/, '105 × 148 mm plus a 3 mm bleed');
  // Rule 20 of the week-weekend spec: the campaign's title, who gave it to whom, the QR code and its link, the three steps, the code in its rectangle, the contents, the message, the validity.
  [
    'BON CADEAU', 'Un bain nordique · semaine', 'offert par Paul à Marie', 'Scannez le QR code', 'site.example.test/bon-cadeau/utiliser',
    'Scannez le QR code avec votre téléphone', 'Choisissez votre créneau en ligne', 'Savourez votre parenthèse en Ardèche', 'Code du bon', code.format(plainCode(voucher)),
    'Votre bon comprend — Bain nordique\u00a0: 2 h en journée · semaine · Planche apéro · Temps supplémentaire\u00a0: 1 h · 2 × Boisson', 'Joyeux anniversaire', 'Valable jusqu’au 15 novembre 2027',
    'Domaine Solio · Saint-Cirq-Lapopie · Lot',
  ].forEach((line) => assert.ok(says(texts, line), `the back says « ${line} »`));
  assert.equal(texts.some((t) => /€|TVA|\bHT\b|TTC|\d+,\d{2}/.test(t)), false, 'no amount, no VAT on a resource voucher');
  assert.deepEqual(seen, [`https://site.example.test/bon-cadeau/utiliser#bon=${plainCode(voucher)}`]);
  assertInsideSafeArea(calls);
});

test('rule 21: a lodging voucher’s back says its value, and only there', async () => {
  const voucher = sell({ slug: 'sejour', amountCents: 15000 });
  const { texts, result } = await recorded(() => api.documents.voucherPdf(voucher));
  assert.ok(says(texts, 'Votre bon comprend — Un séjour dans nos logements, d’une valeur de 150,00 €'));
  assert.equal(texts.filter((t) => /€/.test(t)).length, 1);
  assert.equal(pages(result), 2);
});

test('rule 9: the link base is the setting’s — the QR code and the printed link follow it', async () => {
  const other = fx.openShop({ linkBase: () => 'cadeaux' });
  const voucher = other.api.vouchers.find(other.api.offerService.issueDirect({ request: { slug: 'sejour', amountCents: 15000 }, parties, outcome: 'paid', paymentMethod: 'card', actor: 'user:7' }).voucherId);
  const seen = [];
  const { texts } = await recorded(() => other.api.documents.voucherPdf(voucher, { qr: (url) => { seen.push(url); return require('qrcode').create(url).modules; } }));
  assert.ok(texts.includes('site.example.test/cadeaux/utiliser'));
  assert.ok(seen[0].startsWith('https://site.example.test/cadeaux/utiliser#bon='));
});

test('rule 13, 50: worst-case texts — 40 W, 200 characters with no space, a long company name — stay inside the safe area on both cards', async () => {
  const voucher = sell({ slug: bath.slug }, { parties: { recipientFirstName: 'W'.repeat(40), recipientLastName: 'W'.repeat(40), senderName: 'W'.repeat(40), message: 'x'.repeat(200) } });
  const { calls, result } = await recorded(() => api.documents.voucherPdf(voucher));
  assert.equal(pages(result), 2);
  assertInsideSafeArea(calls);
});

test('rule 50: the legal mention runs along the right edge, turned a quarter, inside the safe area, and the website closes the back — on the voucher and on the merchant card', async () => {
  await withMerchantVisual();
  const voucher = sell();
  const checkBack = ({ texts, calls }, safeRight) => {
    assert.ok(texts.includes(LEGAL_MENTION), 'the mention is drawn');
    assert.ok(calls.rotate.some(([angle, options]) => angle === 90 && options.origin[0] >= safeRight - mm(5) && options.origin[0] <= safeRight), 'rotated 90°, inside the right margin');
    assert.ok(texts.includes('Domaine Solio · Saint-Cirq-Lapopie · Lot'), 'the company, its town and its department close the back');
  };
  checkBack(await recorded(() => api.documents.voucherPdf(voucher)), SAFE.right);
  const merchant = await recorded(() => api.documents.merchantCardPdf(api.campaigns.find(bath.id)));
  checkBack(merchant, SAFE.right + mm(5));
});

async function withMerchantVisual() {
  const current = api.campaigns.find(bath.id);
  if (current.merchantVisualId) return { visualId: current.merchantVisualId };
  const bytes = await picture(1300, 1832, { format: 'png', background: '#aa5500' });
  const visualId = api.visuals.insert({ name: 'Carte', use: 'merchant', file: { path: images.store(bytes, filesDir(), 'png'), width: 1300, height: 1832 } });
  api.campaigns.update(bath.id, { ...current, merchantVisualId: visualId });
  return { visualId };
}

test('rules 33, 34 and 19: the merchant card — title and subtitle, the three steps, one empty code rectangle 16 mm high, the validity and where a card received is used — and no number, no amount', async () => {
  await withMerchantVisual();
  const seen = [];
  const { result, texts, calls } = await recorded(() => api.documents.merchantCardPdf(api.campaigns.find(bath.id), { qr: (url) => { seen.push(url); return require('qrcode').create(url).modules; } }));
  assert.equal(pages(result), 2);
  assert.match(result.toString('latin1'), /\/MediaBox \[0 0 342\.99\d* 464\.88\d*\]/, 'the trim and the bleed plus a slug for the crop marks');
  [
    'Offrez un bon cadeau', 'en quelques minutes, depuis votre téléphone', 'Scannez le QR code avec votre téléphone', 'Choisissez et réglez le bon sur notre site',
    'Recopiez ci-dessous le code reçu par mail, offrez la carte', 'Code du bon', 'Valable 12 mois à partir du paiement.', 'site.example.test/bon-cadeau/offrir/bain-jour',
    'Vous avez reçu cette carte ? site.example.test/bon-cadeau/utiliser',
  ].forEach((line) => assert.ok(says(texts, line), `the card says « ${line} »`));
  assert.equal(texts.some((t) => /€|BC-\d|\d{4}-\d{4}/.test(t)), false, 'no number and no amount without a price to print');
  assert.deepEqual(seen, ['https://site.example.test/bon-cadeau/offrir/bain-jour'], 'one QR code, the offer’s');
  const boxes = calls.roundedRect.map(([x, y, w, h]) => ({ x, y, w, h }));
  const codeBoxes = boxes.filter((b) => b.h === CODE_BOX_HEIGHT);
  assert.equal(codeBoxes.length, 1, 'a single rectangle for the code, no guide cells');
  assert.equal(CODE_BOX_HEIGHT, mm(16));
  assert.ok(codeBoxes[0].w >= SAFE.right - SAFE.left - mm(5) - 1, 'as wide as the text block, which leaves the right strip to the legal mention');
  assert.equal(boxes.filter((b) => b.y > codeBoxes[0].y && b.y < codeBoxes[0].y + codeBoxes[0].h).length, 0, 'nothing inside it');
  assertInsideSafeArea(calls, mm(5));
});

test('rule 33: the merchant card is refused with a sentence without a merchant front, a slug or the website; refused, it locks nothing', async () => {
  const noFront = api.campaigns.insert(campaignRules.validateCampaign(fx.bathCampaign(ids, { slug: 'sans-carte' }), fx.rulesContext(api)).value);
  const server = await fx.serve(api);
  try {
    const res = await fetch(`${server.base}/api/gift-vouchers/campaigns/${noFront}/merchant-card.pdf`);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'Cette campagne n’a pas de visuel pour la carte du commerçant : en choisir un d’abord.');
    assert.equal(api.campaigns.find(noFront).slugLockedAt, null);
    assert.equal((await fetch(`${server.base}/api/gift-vouchers/campaigns/999/merchant-card.pdf`)).status, 404);
  } finally {
    await server.close();
  }
  const bare = { ...api.campaigns.find(bath.id), slug: null };
  await assert.rejects(api.documents.merchantCardPdf(bare), { code: 'CAMPAIGN_NO_SLUG' });
});

test('rules 9, 49: downloading the merchant card locks the slug — the link is printed — and the form then refuses to change it', async () => {
  await withMerchantVisual();
  const server = await fx.serve(api);
  try {
    assert.equal(api.campaigns.find(bath.id).slugLockedAt, null, 'free until a card is printed');
    const res = await fetch(`${server.base}/api/gift-vouchers/campaigns/${bath.id}/merchant-card.pdf`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), /attachment; filename="carte-commercant-bain-jour\.pdf"/);
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.ok(api.campaigns.find(bath.id).slugLockedAt, 'locked');
    const put = await server.call('PUT', `/api/gift-vouchers/campaigns/${bath.id}`, { slug: 'autre-lien' });
    assert.equal(put.status, 422);
    assert.match(put.body.errors[0].message, /verrouillé/);
    assert.equal((await fetch(`${server.base}/api/gift-vouchers/campaigns/${bath.id}/merchant-card.pdf`)).status, 200, 'it can be downloaded again');
  } finally {
    await server.close();
  }
});

test('rule 48: the front is the visual version frozen on the voucher, embedded as uploaded and scaled to cover the bleed; a visual replaced later changes nothing', async () => {
  const first = await picture(1300, 1832, { background: '#2f5d50' });
  const visualId = api.visuals.insert({ name: 'Façade', use: 'voucher', file: { path: images.store(first, filesDir(), 'jpeg'), width: 1300, height: 1832 } });
  const campaign = api.campaigns.find(bath.id);
  api.campaigns.update(bath.id, { ...campaign, voucherVisualId: visualId });
  const voucher = sell();
  const second = await picture(1400, 1974, { background: '#aa0000' });
  api.visuals.addVersion(visualId, { path: images.store(second, filesDir(), 'jpeg'), width: 1400, height: 1974 });
  const { result, calls } = await recorded(() => api.documents.voucherPdf(voucher));
  assert.ok(result.includes(first), 'the first version’s bytes are in the PDF, untouched');
  assert.equal(result.includes(second), false, 'the replacement is not');
  assert.match(result.toString('latin1'), /DCTDecode/, 'a JPEG is embedded as a JPEG, never resampled');
  const [, x, y, size] = calls.image.find(([picture_]) => picture_ && picture_.width === 1300);
  assert.ok(x <= 0 && y <= 0 && x + size.width >= mm(111) - 0.01 && y + size.height >= mm(154) - 0.01, 'it covers the 111 × 154 mm bleed box');
  const newer = sell();
  assert.ok((await api.documents.voucherPdf(newer)).includes(second), 'a voucher issued after takes the new version');
});

test('rules 20, 57: the mail — greeting, title, parties, the code in large type, the printing sentence, the contents, the validity — and the PDF attached', async () => {
  const voucher = sell({ slug: bath.slug, addOns: [{ articleRef: `option:${ids.drink}`, qty: 1 }], extraMinutes: 60 });
  sent.length = 0;
  await api.receipt.deliver(voucher, { actor: 'system', idempotencyKey: `t-mail-${voucher.id}` });
  const [mail] = sent;
  const formatted = code.format(plainCode(voucher));
  assert.equal(mail.to, 'paul@example.test');
  assert.equal(mail.subject, 'Votre bon cadeau : Un bain nordique · semaine');
  const printNote = 'Le PDF joint s\'imprime tel quel. Si vous avez la carte du commerçant, vous pouvez aussi recopier le code dans l\'encart blanc.';
  [
    'Bonjour,', 'Un bain nordique · semaine', 'Pour Marie de la part de Paul', formatted, printNote, 'Le bon comprend :',
    '- Bain nordique\u00a0: 2 h en journée · semaine', '- Planche apéro', '- Temps supplémentaire\u00a0: 1 h', '- Boisson', 'Valable jusqu’au 15/11/2027.',
  ].forEach((line) => assert.ok(mail.text.includes(line), `the text says « ${line} »`));
  assert.ok(mail.html.includes(formatted) && mail.html.includes('font-size:26px'), 'the code in large type');
  assert.ok(mail.html.includes(printNote.replace(/'/g, '&#39;')), 'and the sentence in the HTML too');
  assert.ok(mail.text.indexOf(formatted) < mail.text.indexOf(printNote), 'the sentence comes under the code');
  assert.deepEqual(mail.attachments.map((a) => [a.filename, a.contentType, pages(a.content)]), [[`${voucher.number}.pdf`, 'application/pdf', 2]]);
});

test('rule 20: the invoice-style recap — date, number, each line with quantity, price and VAT, the total, « dont TVA » per rate — comes from what was frozen and moves with nothing', async () => {
  const voucher = sell({ slug: bath.slug, addOns: [{ articleRef: `option:${ids.drink}`, qty: 2 }], extraMinutes: 60 });
  const write = async () => {
    sent.length = 0;
    await api.receipt.deliver(voucher, { actor: 'system', idempotencyKey: `t-recap-${voucher.id}-${Math.random()}` });
    return sent[0];
  };
  const mail = await write();
  const lines = mail.text.split('\n');
  assert.ok(lines.includes('Date : 15/11/2026 · Bon n° BC-2026-' + String(voucher.number.slice(-4))));
  assert.ok(lines.includes('- 1 × Bain nordique · journée · semaine · 95,00 € TTC l’unité · TVA 20 % · 95,00 €'));
  assert.ok(lines.includes('- 1 × Planche apéro · 14,00 € TTC l’unité · TVA 10 % · 14,00 €'));
  assert.ok(lines.some((l) => /^- 2 × Boisson · 6,50 € TTC l’unité · TVA 20 % · 13,00 €$/.test(l)));
  const total = lines.find((l) => l.startsWith('Total payé TTC : '));
  assert.equal(total, `Total payé TTC : ${require('../voucherRules').formatEuros(voucher.amountCents)}`);
  assert.deepEqual(lines.filter((l) => l.startsWith('dont TVA')).sort(), [
    `dont TVA 10 % : ${require('../voucherRules').formatEuros(JSON.parse(voucher.vatLines).find((l) => l.ratePercent === 10).vatCents)}`,
    `dont TVA 20 % : ${require('../voucherRules').formatEuros(JSON.parse(voucher.vatLines).find((l) => l.ratePercent === 20).vatCents)}`,
  ]);
  assert.match(mail.html, /<table/);
  assert.match(mail.html, /Total payé TTC : /);
  require('../../../models/standaloneSalesModel').setExternalRate('resources', 5.5);
  try {
    assert.equal((await write()).text.split('\n').filter((l) => l.startsWith('- 1 × Bain nordique'))[0], '- 1 × Bain nordique · journée · semaine · 95,00 € TTC l’unité · TVA 20 % · 95,00 €', 'a rate that moved since changes nothing');
  } finally {
    require('../../../models/standaloneSalesModel').setExternalRate('resources', 20);
  }
});

test('rule 20: a voucher given away has no payment recap; a lodging voucher’s recap is its single amount at its frozen rate; English follows the buyer', async () => {
  const given = sell({ slug: bath.slug }, { outcome: 'offered' });
  sent.length = 0;
  await api.receipt.deliver(given, { actor: 'system', idempotencyKey: `t-given-${given.id}` });
  assert.equal(/Récapitulatif|Total payé|TVA/.test(sent[0].text), false);
  assert.equal(/Récapitulatif/.test(sent[0].html), false);
  assert.ok(sent[0].text.includes(code.format(plainCode(given))), 'the code still goes');
  const lodging = sell({ slug: 'sejour', amountCents: 15000 }, { parties: { language: 'en' } });
  sent.length = 0;
  await api.receipt.deliver(lodging, { actor: 'system', idempotencyKey: `t-lodging-${lodging.id}` });
  const { text, subject } = sent[0];
  assert.equal(subject, 'Your gift voucher: Bon cadeau');
  assert.ok(text.includes('- 1 × Bon cadeau · 150,00 € incl. VAT each · VAT 10% · 150,00 €'));
  assert.ok(text.includes('Total paid incl. VAT: 150,00 €') && text.includes('including VAT 10%: 13,64 €'));
  assert.ok(text.includes('The attached PDF prints as it is.'));
});

test('rules 48, 49: « Télécharger » and « Renvoyer le mail » go to a voucher still usable — to the giver, or to a typed address, written in the history — and not to one used, expired or cancelled', async () => {
  const server = await fx.serve(api);
  const call = (method, path, body) => server.call(method, `/api/gift-vouchers/${path}`, body);
  try {
    const voucher = sell();
    sent.length = 0;
    const typed = await call('POST', `${voucher.id}/resend`, { email: 'autre@example.test' });
    assert.equal(typed.status, 200, JSON.stringify(typed.body));
    assert.equal(sent[0].to, 'autre@example.test');
    const history = api.movements.list(voucher.id).filter((m) => m.kind === 'mail');
    assert.deepEqual(history.map((m) => [m.actor, m.note]), [['user:7', 'Renvoyé à autre@example.test']]);
    assert.deepEqual(typed.body.movements.filter((m) => m.kind === 'mail').map((m) => [m.actorName, m.note]), [['Adrien Test', 'Renvoyé à autre@example.test']]);
    await call('POST', `${voucher.id}/resend`, {});
    assert.equal(sent[1].to, 'paul@example.test', 'the giver’s own address by default');
    assert.equal(api.movements.list(voucher.id).filter((m) => m.kind === 'mail').length, 2, 'each resend is in the history');
    assert.equal((await call('POST', `${voucher.id}/resend`, { email: 'nope' })).body.code, 'EMAIL_INVALID');
    assert.equal((await call('GET', `${voucher.id}/pdf`)).status, 200);
    assert.equal((await call('GET', String(voucher.id))).body.canDownload, true);

    const used = sell();
    api.movements.append({ voucherId: used.id, kind: 'redeem', amountCents: -used.amountCents, actor: 'system', reservationId: 5, idempotencyKey: `t-used-${used.id}` });
    const cancelled = sell();
    await call('POST', `${cancelled.id}/cancel`, {});
    const expired = sell();
    api.vouchers.setExpiry(expired.id, '2026-11-14'); // date-literal-ok: the suite runs on its own clock, never the real today
    for (const [label, v] of [['used', used], ['cancelled', cancelled], ['expired', expired]]) {
      const pdf = await call('GET', `${v.id}/pdf`);
      const resend = await call('POST', `${v.id}/resend`, {});
      const expectedCode = label === 'cancelled' ? 'VOUCHER_CANCELLED' : 'VOUCHER_NOT_USABLE';
      assert.deepEqual([pdf.status, pdf.body && pdf.body.code, resend.body.code], [409, expectedCode, expectedCode], label);
      assert.equal((await call('GET', String(v.id))).body.canDownload, false, label);
    }
  } finally {
    await server.close();
  }
});

test('rule 49: a missing website address refuses the PDF and the mail with a sentence, the voucher untouched', async () => {
  const bare = fx.openShop({ company: async () => ({ name: 'Domaine Solio', town: '', website: '', logo: null }) });
  const voucher = bare.api.vouchers.find(bare.api.offerService.issueDirect({ request: { slug: 'sejour', amountCents: 15000 }, parties, outcome: 'paid', paymentMethod: 'card', actor: 'user:7' }).voucherId);
  const server = await fx.serve(bare.api);
  try {
    const res = await server.call('GET', `/api/gift-vouchers/${voucher.id}/pdf`);
    assert.deepEqual([res.status, res.body.code], [409, 'NO_SITE_ORIGIN']);
    assert.match(res.body.error, /adresse du site web/);
    assert.equal((await server.call('POST', `/api/gift-vouchers/${voucher.id}/resend`, {})).body.code, 'NO_SITE_ORIGIN');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gift_voucher_movements WHERE kind = \'mail\' AND voucherId = ?').get(voucher.id).n, 0);
  } finally {
    await server.close();
  }
});
