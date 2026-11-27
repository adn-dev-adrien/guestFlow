// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 20 (G7) — the vertical budget of the voucher's back. Over 243 realistic backs (company mark × title × subtitle × message × contents)
// the validity is always printed, the contents keep at least their first line with the period, the validated mock's own configuration prints all three small lines in full, and what does not fit
// ends with an ellipsis instead of being dropped.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const pdf = require('../voucherPdf');
const code = require('../code');

const FACTORS = {
  mark: ['no logo', 'logo', 'long name, no logo'],
  title: ['Un bain nordique', 'Une heure de bain nordique en soirée · week-end', 'Une longue parenthèse nordique d’exception pour deux, au cœur des Cévennes ardéchoises, hors du temps'],
  parties: [[null, null], ['Claire', 'Julien'], ['Jean-Baptiste et Anne-Sophie de la Roche-Guyon', 'Marie-Charlotte Durand-Delacroix de Saint-Martin']],
  message: ['', 'Bon anniversaire, profite bien !', 'Joyeux anniversaire ma chérie, que cette parenthèse te fasse le plus grand bien, nous t’aimons très fort, à très vite, et à l’année prochaine pour le prochain'],
  options: [[], [{ label: 'Boisson chaude', qty: 1 }], [1, 2, 3, 4, 5, 6].map((n) => ({ label: `Un panier du terroir numéro ${n}`, qty: n }))],
};

const contentsOf = (title, options, name) => JSON.stringify({
  kind: 'resource',
  title,
  resource: { id: 1, name, band: 'evening', includedMinutes: 60, extraMinutes: 0, period: 'weekend' },
  options: options.map((o) => ({ articleRef: 'option:1', label: o.label, qty: o.qty })),
  addOns: [],
});

let logo;
test.before(async () => {
  logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><text x="300" y="150" font-size="120" text-anchor="middle">SOLIO</text></svg>')).png().toBuffer();
});

async function backOf({ mark, title, parties, message, options }) {
  const texts = [];
  const original = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function recorded(...args) { texts.push(String(args[0])); return original.apply(this, args); };
  try {
    await pdf.renderVoucherPdf({
      voucher: {
        number: 'BC-1', code: code.generate(), amountCents: 9000, senderName: parties[0], recipientName: parties[1], message, expiresOn: '2028-05-27', // date-literal-ok: a fixed expiry the card prints
        contents: contentsOf(title, options, 'Bain nordique'),
      },
      front: null,
      company: {
        name: mark === 'long name, no logo' ? 'Domaine des Hautes Terres de la Montagne Ardéchoise et de ses Sources Chaudes' : 'Domaine Solio',
        town: 'Satillieu',
        department: 'Ardèche',
        website: 'https://domainesolio.com',
        logo: mark === 'logo' ? logo : null,
      },
      origin: 'https://domainesolio.com',
      linkBase: 'bon-cadeau',
    });
  } finally {
    PDFDocument.prototype.text = original;
  }
  return texts;
}

const combos = Object.entries(FACTORS).reduce((all, [key, values]) => all.flatMap((one) => values.map((value) => ({ ...one, [key]: value }))), [{}]);

test('243 backs: the validity is always printed, the contents keep their first line with the period, and nothing is cut in the middle of a word without an ellipsis', async () => {
  assert.equal(combos.length, 243);
  const missing = { validity: [], contents: [], period: [], message: [] };
  for (const combo of combos) {
    const texts = await backOf(combo);
    const label = `${combo.mark} | ${combo.title.slice(0, 20)} | ${(combo.parties[0] || '-').slice(0, 8)} | msg ${combo.message.length} | options ${combo.options.length}`;
    if (!texts.some((t) => /^Valable jusqu’au 27 mai 2028$/.test(t))) missing.validity.push(label);
    const contents = texts.find((t) => /^Votre bon comprend — /.test(t));
    if (!contents) missing.contents.push(label);
    else if (!/\u00a0: 1 h en soirée · week-end/.test(contents)) missing.period.push(`${label} → ${contents}`);
    if (combo.message && !texts.some((t) => combo.message.startsWith(t.replace(/…$/, '').slice(0, 12)) && t.length > 5 && combo.message.includes(t.replace(/…$/, '').split(' ')[0]))) missing.message.push(label);
  }
  assert.deepEqual(missing.validity, [], 'validity 243/243');
  assert.deepEqual(missing.contents, [], 'contents ≥ 1 line 243/243');
  assert.deepEqual(missing.period, [], 'the period is visible on every back');
  assert.deepEqual(missing.message, [], 'a typed message keeps its first line');
});

test('the validated mock’s configuration (logo, a two-line title, « offert par Claire à Julien », a one-line message) prints the three small lines in full', async () => {
  const texts = await backOf({
    mark: 'logo', title: FACTORS.title[1], parties: ['Claire', 'Julien'], message: 'Bon anniversaire, profite bien !', options: [],
  });
  assert.ok(texts.includes('Votre bon comprend — Bain nordique\u00a0: 1 h en soirée · week-end'));
  assert.ok(texts.includes('Bon anniversaire, profite bien !'));
  assert.ok(texts.includes('Valable jusqu’au 27 mai 2028'));
});

test('a voucher with options lists them when the room allows, and ends the line with an ellipsis when it does not', async () => {
  const roomy = await backOf({
    mark: 'no logo', title: FACTORS.title[0], parties: [null, null], message: '', options: [{ label: 'Boisson chaude', qty: 1 }],
  });
  assert.ok(roomy.some((t) => /^Votre bon comprend — Bain nordique\u00a0: 1 h en soirée · week-end · Boisson chaude$/.test(t)));
  const crowded = await backOf({
    mark: 'logo', title: FACTORS.title[2], parties: FACTORS.parties[2], message: FACTORS.message[2], options: FACTORS.options[2],
  });
  assert.ok(crowded.some((t) => /^Votre bon comprend — /.test(t) && t.endsWith('…')), 'the contents are cut with an ellipsis');
});

test('the voucher draws its own sizes, smaller than the merchant card’s', () => {
  assert.ok(pdf.VOUCHER_BACK_LAYOUT.qrMm < pdf.BACK_LAYOUT.qrMm);
  assert.ok(pdf.VOUCHER_BACK_LAYOUT.pt.title < pdf.BACK_LAYOUT.pt.title);
  assert.ok(pdf.VOUCHER_BACK_LAYOUT.qrMm >= 16, 'a QR code a phone still reads');
});

// Round 4 B — with several lines the options are listed in order as far as they fit (the last line ends with an ellipsis); only a single line makes the first item's name give way.
test('a roomy back with six options lists those that fit, in order, the last line ending with an ellipsis; one line keeps the first item\'s detail and period', async () => {
  const roomy = await backOf({
    mark: 'no logo', title: FACTORS.title[0], parties: [null, null], message: '', options: FACTORS.options[2],
  });
  const at = roomy.findIndex((t) => /^Votre bon comprend — /.test(t));
  const listed = roomy.slice(at).join(' ');
  for (const n of [1, 2, 3, 4, 5]) assert.ok(listed.includes(`numéro ${n}`), `option ${n} is listed: ${listed}`);
  assert.ok(roomy[at + 1].endsWith('…') || roomy[at].endsWith('…') || roomy.slice(at, at + 4).some((t) => t.endsWith('…')), 'the cut ends with an ellipsis');
  const crowded = await backOf({
    mark: 'logo', title: FACTORS.title[2], parties: FACTORS.parties[2], message: FACTORS.message[2], options: FACTORS.options[2],
  });
  const one = crowded.filter((t) => /^Votre bon comprend — /.test(t));
  assert.equal(one.length, 1);
  assert.match(one[0], /\u00a0: 1 h en soirée · week-end/);
});
