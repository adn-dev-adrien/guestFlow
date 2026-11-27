// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 20 (L4) — « Votre bon comprend » is built once the lines are allotted: the whole text when it fits them, otherwise the resource's
// name gives way (an ellipsis) and the detail and the period stay whole, with room kept for « ·… » when other items follow. Over resource names of 13 to 60 characters × a roomy and a crowded back ×
// with and without another item, the validity is always printed and the period is whole on every back.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const pdf = require('../voucherPdf');
const code = require('../code');

const WORDS = ['Bain', 'nordique', 'au', 'feu', 'de', 'bois', 'sous', 'les', 'étoiles', 'du', 'Domaine', 'Solio', 'et', 'ses', 'sources', 'chaudes'];
const NAMES = Array.from({ length: WORDS.length - 1 }, (_, n) => WORDS.slice(0, n + 2).join(' ')).filter((name) => name.length >= 13 && name.length <= 60);
const BACKS = {
  roomy: { title: 'Un bain', parties: [null, null], message: '' },
  crowded: {
    title: 'Une heure de bain nordique en soirée · week-end', parties: ['Jean-Baptiste et Anne-Sophie de la Roche-Guyon', 'Marie-Charlotte Durand-Delacroix de Saint-Martin'],
    message: 'Joyeux anniversaire ma chérie, que cette parenthèse te fasse le plus grand bien, nous t’aimons très fort, à très vite, et à l’année prochaine pour le prochain',
  },
};
const DETAIL = ' : 1 h en soirée · week-end';

let logo;
test.before(async () => {
  logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><text x="300" y="150" font-size="120" text-anchor="middle">SOLIO</text></svg>')).png().toBuffer();
});

async function textsOf({ name, back, withOther }) {
  const texts = [];
  const original = PDFDocument.prototype.text;
  PDFDocument.prototype.text = function recorded(...args) { texts.push(String(args[0])); return original.apply(this, args); };
  try {
    await pdf.renderVoucherPdf({
      voucher: {
        number: 'BC-1', code: code.generate(), amountCents: 9000, senderName: back.parties[0], recipientName: back.parties[1], message: back.message, expiresOn: '2028-05-27', // date-literal-ok: a fixed expiry the card prints
        contents: JSON.stringify({
          kind: 'resource',
          title: back.title,
          resource: { id: 1, name, band: 'evening', includedMinutes: 60, extraMinutes: 0, period: 'weekend' },
          options: withOther ? [{ articleRef: 'option:1', label: 'Planche apéritive', qty: 1 }] : [],
          addOns: [],
        }),
      },
      front: null,
      company: { name: 'Domaine Solio', town: 'Satillieu', department: 'Ardèche', website: 'https://domainesolio.com', logo },
      origin: 'https://domainesolio.com',
      linkBase: 'bon-cadeau',
    });
  } finally {
    PDFDocument.prototype.text = original;
  }
  return texts;
}

test('every name length × roomy / crowded × with / without another item: the validity is printed and the detail and the period are whole', async () => {
  assert.ok(NAMES.length >= 8);
  const broken = [];
  for (const name of NAMES) {
    for (const [kind, back] of Object.entries(BACKS)) {
      for (const withOther of [false, true]) {
        const texts = await textsOf({ name, back, withOther });
        const label = `${name.length} chars | ${kind} | ${withOther ? 'with' : 'without'} another item`;
        if (!texts.some((t) => /^Valable jusqu’au 27 mai 2028$/.test(t))) broken.push(`${label}: no validity`);
        const lines = texts.slice(texts.findIndex((t) => /^Votre bon comprend — /.test(t)));
        const joined = lines.slice(0, 2).join(' ');
        if (!lines.length || !joined.includes(DETAIL)) broken.push(`${label}: the period is not whole → ${JSON.stringify(lines.slice(0, 2))}`);
        if (kind === 'roomy' && !withOther && !joined.includes(`— ${name}${DETAIL}`)) broken.push(`${label}: the name was cut with room to spare → ${JSON.stringify(lines.slice(0, 1))}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('a crowded back cut to one line keeps room for « ·… » after the period when another item follows', async () => {
  const texts = await textsOf({ name: WORDS.slice(0, 12).join(' '), back: BACKS.crowded, withOther: true });
  const line = texts.find((t) => /^Votre bon comprend — /.test(t));
  assert.match(line, /… : 1 h en soirée · week-end ·…$/);
});
