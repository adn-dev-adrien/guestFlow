/**
 * The voucher as one A4 page (specs/gift-vouchers.md rule 22): the voucher on the top half, the conditions of use below,
 * and a QR code to the booking page carrying the code in the URL fragment (`#bon=<code>`), which a browser never sends to a
 * server. Every free text is wrapped by hand inside its box — a 40-character name of `W` or a 200-character message with no
 * space never leaves it (rule 13, last edge case).
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const sdk = require('../sdk');
const code = require('./code');
const rules = require('./voucherRules');

const A4 = Object.freeze({ width: 595.28, height: 841.89 });
const MARGIN = 40;
const BOX = Object.freeze({ x: MARGIN, y: MARGIN, width: A4.width - 2 * MARGIN, height: 380 });
const PAD = 26;
const QR_SIZE = 96;
const INK = '#1f2a24';
const MUTED = '#5c665f';
const LINE = '#c9cfc9';

const TEXTS = Object.freeze({
  fr: {
    title: 'Bon cadeau',
    to: 'Pour',
    from: 'De la part de',
    code: 'Code',
    validUntil: (date) => `Valable jusqu’au ${rules.formatFrDate(date)}`,
    number: (n) => `Bon n° ${n}`,
    scan: 'Scanner pour réserver',
    conditionsTitle: 'Conditions d’utilisation',
    conditions: [
      'Ce bon est utilisable en une ou plusieurs réservations directes, jusqu’à épuisement de son solde ou de sa date de validité.',
      'Le code se saisit à l’étape du paiement d’une réservation, sur le site. Le solde inutilisé reste disponible.',
      'Le solde n’est ni remboursable ni échangeable contre de l’argent, et ne donne lieu à aucun rendu de monnaie.',
      'Le code est personnel : il ne peut pas être retrouvé s’il est perdu. Le conserver avec soin.',
    ],
  },
  en: {
    title: 'Gift voucher',
    to: 'For',
    from: 'From',
    code: 'Code',
    validUntil: (date) => `Valid until ${date}`,
    number: (n) => `Voucher no. ${n}`,
    scan: 'Scan to book',
    conditionsTitle: 'Terms of use',
    conditions: [
      'This voucher can be used on one or several direct bookings, until its balance is used up or it expires.',
      'The code is entered at the payment step of a booking, on the website. Any unused balance remains available.',
      'The balance is neither refundable nor exchangeable for money, and no change is given.',
      'The code is personal: it cannot be recovered if lost. Keep it safe.',
    ],
  },
});

/** `https://site/page#bon=<code>` — an existing fragment of the page is replaced. */
const bookingUrlWithCode = (baseUrl, normalised) => `${String(baseUrl).replace(/#.*$/, '')}#bon=${normalised}`;

/**
 * `text` cut into at most `maxLines` lines no wider than `width` in the current font: words stay whole while they fit, a
 * word wider than a line is cut where it overflows, and what does not fit ends with an ellipsis.
 */
function fitLines(doc, text, width, maxLines) {
  const widthOf = (s) => doc.widthOfString(s);
  const lines = [];
  let line = '';
  const push = (next) => { lines.push(next); line = ''; };
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  words.forEach((word) => {
    let rest = word;
    while (rest) {
      const candidate = line ? `${line} ${rest}` : rest;
      if (widthOf(candidate) <= width) { line = candidate; rest = ''; } else if (line) { push(line); } else {
        let cut = rest.length;
        while (cut > 1 && widthOf(rest.slice(0, cut)) > width) cut -= 1;
        push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
    }
  });
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && widthOf(`${last}…`) > width) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}…`;
  return kept;
}

const defaultQr = (url) => QRCode.toBuffer(url, { type: 'png', width: 600, margin: 1, errorCorrectionLevel: 'M' });

/**
 * → a Buffer holding the PDF. `voucher.code` is the normalised code; `qr(url)` is injectable so a suite reads what the
 * code points at.
 */
async function renderVoucherPdf({
  brand, voucher, bookingUrl, language = 'fr',
}, { qr = defaultQr } = {}) {
  const t = TEXTS[language] || TEXTS.fr;
  const qrBuffer = await qr(bookingUrlWithCode(bookingUrl, voucher.code));
  const doc = new PDFDocument({
    size: 'A4', margin: MARGIN, info: { Title: `${t.title} ${voucher.number}` },
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const F = sdk.coreModule('pdfFonts').registerFaces(doc);
  const inner = BOX.width - 2 * PAD;
  const left = BOX.x + PAD;
  let y = BOX.y + PAD;

  const draw = (text, { font, size, color = INK, align = 'center', width = inner, x = left, maxLines = 1, gap = 6 }) => {
    doc.font(font).fontSize(size).fillColor(color);
    const lines = fitLines(doc, text, width, maxLines);
    lines.forEach((line) => {
      doc.text(line, x, y, { width, align, lineBreak: false });
      y += doc.currentLineHeight();
    });
    y += gap;
  };

  doc.roundedRect(BOX.x, BOX.y, BOX.width, BOX.height, 14).lineWidth(1.2).strokeColor(LINE).stroke();
  draw(brand, { font: F.serif, size: 18, maxLines: 2, color: MUTED });
  draw(t.title, { font: F.serif, size: 34, gap: 4 });
  draw(rules.formatEuros(voucher.amountCents), { font: F.bold, size: 40, gap: 12 });
  if (voucher.recipientName) draw(`${t.to} ${voucher.recipientName}`, { font: F.bold, size: 15, maxLines: 2, gap: 2 });
  if (voucher.senderName) draw(`${t.from} ${voucher.senderName}`, { font: F.regular, size: 13, color: MUTED, maxLines: 2, gap: 6 });
  if (voucher.message) draw(voucher.message, { font: F.italic, size: 12, maxLines: 5, gap: 10 });

  const footerY = BOX.y + BOX.height - PAD - QR_SIZE;
  y = Math.max(y + 4, footerY);
  const textWidth = inner - QR_SIZE - 16;
  const caption = y;
  draw(t.code, { font: F.regular, size: 10, color: MUTED, align: 'left', width: textWidth, gap: 0 });
  draw(code.format(voucher.code), { font: F.bold, size: 22, align: 'left', width: textWidth, gap: 4 });
  draw(t.validUntil(voucher.expiresOn), { font: F.regular, size: 11, align: 'left', width: textWidth, gap: 0 });
  draw(t.number(voucher.number), { font: F.regular, size: 10, color: MUTED, align: 'left', width: textWidth, gap: 0 });
  doc.image(qrBuffer, BOX.x + BOX.width - PAD - QR_SIZE, caption - 4, { width: QR_SIZE, height: QR_SIZE });
  y = caption - 4 + QR_SIZE + 2;
  doc.font(F.regular).fontSize(8).fillColor(MUTED).text(t.scan, BOX.x + BOX.width - PAD - QR_SIZE, y, { width: QR_SIZE, align: 'center', lineBreak: false });

  y = BOX.y + BOX.height + 30;
  draw(t.conditionsTitle, { font: F.bold, size: 13, align: 'left', width: BOX.width, x: BOX.x, gap: 6 });
  t.conditions.forEach((line) => draw(`• ${line}`, {
    font: F.regular, size: 11, color: MUTED, align: 'left', width: BOX.width, x: BOX.x, maxLines: 3, gap: 4,
  }));
  doc.end();
  return done;
}

module.exports = { renderVoucherPdf, bookingUrlWithCode, fitLines };
