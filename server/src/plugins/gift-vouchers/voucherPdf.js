/**
 * The printed cards of the plugin (specs/gift-voucher-campaigns.md rules 21, 22, 33, 34, 49, 50): the voucher the giver receives and the merchant card a printer produces. Both
 * are A6 portrait, 105 × 148 mm, with a 3 mm bleed, two pages — the front, then the back. The front is the visual picked in the library, embedded as uploaded (never resampled)
 * and scaled to cover the bleed. The back is drawn here, text and QR code as vectors with the fonts embedded: the voucher's back carries the code and what the voucher
 * contains (no amount on a resource voucher), the merchant card's the four steps of an offer and a box to copy the code into (no number, no amount). Every printed back carries
 * the legal mention along its right edge, and the company name, town and website at its foot (rule 50). Every free text is wrapped by hand inside its box.
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const sdk = require('../sdk');
const code = require('./code');
const rules = require('./voucherRules');
const { contentLines } = require('./contentsText');

const MM = 72 / 25.4;
const mm = (n) => n * MM;
const TRIM = Object.freeze({ width: mm(105), height: mm(148) });
const BLEED = mm(3);
const SAFE = mm(5);
const SLUG = mm(5);
const MARK_LENGTH = mm(4);
const LEGAL_MENTION = 'Ne pas jeter sur la voie publique.';
const INK = '#1f2a24';
const MUTED = '#5c665f';
const LINE = '#c9cfc9';
const GUIDE = '#dfe3df';
const QR_SIZE = mm(23);
// The strip along the right edge that the vertical legal mention occupies, inside the safe area.
const LEGAL_STRIP = mm(5);
const CODE_BOX_HEIGHT = mm(24);
const STEPS = Object.freeze([
  'Scannez pour choisir la formule',
  'Paiement sécurisé en ligne',
  'Recopiez ci-dessous le code reçu par mail',
  'Faites plaisir, offrez la carte',
]);

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

/** `https://site/<base>/utiliser#bon=<code>` — the redemption page of rule 9, the code in the fragment a browser never sends to a server (rule 22). */
const redeemUrl = ({ origin, linkBase }, normalised) => `${origin}/${linkBase}/utiliser${normalised ? `#bon=${normalised}` : ''}`;
const offerUrl = ({ origin, linkBase }, slug) => `${origin}/${linkBase}/offrir/${slug}`;
/** The link as it is printed: no scheme, no fragment. */
const shortLink = (url) => url.replace(/^https?:\/\//, '').replace(/#.*$/, '');

const defaultQr = (url) => QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;

/** One drawing surface: the document, its faces, and the safe frame the back is drawn in. */
function createSheet({
  title, slug = 0, marks = false,
}) {
  const width = TRIM.width + 2 * BLEED + 2 * slug;
  const height = TRIM.height + 2 * BLEED + 2 * slug;
  const doc = new PDFDocument({
    size: [width, height], margin: 0, info: { Title: title },
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const trim = {
    left: slug + BLEED, top: slug + BLEED, right: slug + BLEED + TRIM.width, bottom: slug + BLEED + TRIM.height,
  };
  const safe = {
    left: trim.left + SAFE, top: trim.top + SAFE, right: trim.right - SAFE, bottom: trim.bottom - SAFE,
  };
  return {
    doc, done, width, height, trim, slug, marks, safe,
  };
}

/** Crop marks in the slug, at the four corners of the trim, never inside the bleed. */
function drawCropMarks({ doc, trim }) {
  doc.save().lineWidth(0.25).strokeColor('#000000');
  const corners = [[trim.left, trim.top, -1, -1], [trim.right, trim.top, 1, -1], [trim.left, trim.bottom, -1, 1], [trim.right, trim.bottom, 1, 1]];
  corners.forEach(([x, y, dx, dy]) => {
    doc.moveTo(x + dx * BLEED, y).lineTo(x + dx * (BLEED + MARK_LENGTH), y).stroke();
    doc.moveTo(x, y + dy * BLEED).lineTo(x, y + dy * (BLEED + MARK_LENGTH)).stroke();
  });
  doc.restore();
}

/** The front: the picked visual as uploaded, scaled to cover the bleed box and cropped to it; with none picked, a plain card with the company's name. */
function drawFront(sheet, { image, F, companyName }) {
  const {
    doc, slug, trim,
  } = sheet;
  const box = { x: slug, y: slug, w: TRIM.width + 2 * BLEED, h: TRIM.height + 2 * BLEED };
  if (image) {
    const picture = doc.openImage(image);
    const scale = Math.max(box.w / picture.width, box.h / picture.height);
    const w = picture.width * scale;
    const h = picture.height * scale;
    doc.save().rect(box.x, box.y, box.w, box.h).clip();
    doc.image(picture, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, { width: w, height: h });
    doc.restore();
  } else {
    doc.rect(box.x, box.y, box.w, box.h).fill('#f4f1ea');
    doc.font(F.serif).fontSize(22).fillColor(INK).text(companyName, trim.left + SAFE, trim.top + TRIM.height / 2 - 14, {
      width: TRIM.width - 2 * SAFE, align: 'center', lineBreak: false,
    });
  }
  if (sheet.marks) drawCropMarks(sheet);
}

/** A text pen over the back's frame: each call draws at the running `y` and moves it down. */
function createPen(sheet, F) {
  const { doc, safe } = sheet;
  const left = safe.left;
  const right = safe.right - LEGAL_STRIP;
  const width = right - left;
  const state = { y: safe.top };

  /** Draws `text` in at most `maxLines` lines inside `[x, x + w]`. Does not move `y` when `stay` is set. */
  function write(text, {
    font, size, color = INK, align = 'left', x = left, w = width, maxLines = 1, gap = 0, spacing = 0, stay = false,
  }) {
    doc.font(font).fontSize(size).fillColor(color);
    const lines = fitLines(doc, text, w, maxLines);
    let y = state.y;
    lines.forEach((line) => {
      doc.text(line, x, y, {
        width: w, align, lineBreak: false, characterSpacing: spacing,
      });
      y += doc.currentLineHeight();
    });
    if (!stay) state.y = y + gap;
    return y;
  }
  return {
    doc, left, right, width, state, write, safe, F,
  };
}

/** The top of both backs: the logo, or the company's name when there is no logo. */
function drawHeader(pen, { company, F }) {
  const { doc } = pen;
  const height = mm(12);
  if (company.logo) {
    try {
      doc.image(company.logo, pen.left, pen.state.y, {
        fit: [pen.width, height], align: 'center', valign: 'center',
      });
      pen.state.y += height + 8;
      return;
    } catch {
      // a logo pdfkit cannot read leaves the name instead
    }
  }
  pen.write(company.name, {
    font: F.serif, size: 13, align: 'center', maxLines: 2, gap: 8, color: MUTED,
  });
}

/** The QR code as vector squares, its top-left corner at `(x, y)`, `size` points wide. */
function drawQr(doc, modules, x, y, size) {
  const unit = size / modules.size;
  doc.save().fillColor('#000000');
  for (let row = 0; row < modules.size; row += 1) {
    for (let col = 0; col < modules.size; col += 1) {
      if (modules.get(row, col)) doc.rect(x + col * unit, y + row * unit, unit + 0.2, unit + 0.2);
    }
  }
  doc.fill().restore();
}

/** Rule 50 — the legal mention, turned a quarter along the right edge, inside the safe area. */
function drawLegalMention(sheet, F) {
  const { doc, safe } = sheet;
  const size = 7;
  doc.font(F.regular).fontSize(size).fillColor(MUTED);
  const length = doc.widthOfString(LEGAL_MENTION);
  const cx = safe.right - LEGAL_STRIP / 2;
  const cy = (safe.top + safe.bottom) / 2;
  doc.save().rotate(90, { origin: [cx, cy] });
  doc.text(LEGAL_MENTION, cx - length / 2, cy - size / 2, { lineBreak: false });
  doc.restore();
}

/** Rule 50 — company name and town, then the website, centred at the foot of the back. */
function drawFooter(pen, { company, F }) {
  const lineHeight = mm(4);
  const bottom = pen.safe.bottom;
  const identity = [company.name, company.town].filter(Boolean).join(' · ');
  const wasY = pen.state.y;
  pen.state.y = bottom - 2 * lineHeight;
  pen.write(identity, {
    font: F.bold, size: 8, align: 'center', color: INK, maxLines: 1, stay: true,
  });
  pen.state.y = bottom - lineHeight;
  if (company.website) {
    pen.write(shortLink(company.website), {
      font: F.regular, size: 8, align: 'center', color: MUTED, maxLines: 1, stay: true,
    });
  }
  pen.state.y = wasY;
}

function drawRule(pen) {
  const { doc } = pen;
  const center = pen.left + pen.width / 2;
  doc.save().lineWidth(0.6).strokeColor(LINE).moveTo(center - 20, pen.state.y).lineTo(center + 20, pen.state.y).stroke().restore();
  pen.state.y += 8;
}

function drawVoucherBack(sheet, {
  F, company, voucher, url, link, qrModules,
}) {
  sheet.doc.addPage({ size: [sheet.width, sheet.height], margin: 0 });
  const pen = createPen(sheet, F);
  const { doc, state } = pen;
  drawHeader(pen, { company, F });
  pen.write('BON CADEAU', {
    font: F.serif, size: 20, align: 'center', gap: 4, spacing: 2,
  });
  drawRule(pen);
  pen.write('Pour l’utiliser', {
    font: F.bold, size: 10, gap: 4,
  });
  const qrTop = state.y;
  drawQr(doc, qrModules(url), pen.left, qrTop, QR_SIZE);
  const sideX = pen.left + QR_SIZE + mm(3);
  const sideW = pen.right - sideX;
  state.y = qrTop;
  pen.write('Scannez pour réserver votre cadeau ou suivez ce lien :', {
    font: F.regular, size: 8.5, x: sideX, w: sideW, maxLines: 3, gap: 3,
  });
  pen.write(link, {
    font: F.bold, size: 8.5, x: sideX, w: sideW, maxLines: 3,
  });
  state.y = Math.max(state.y, qrTop + QR_SIZE) + mm(3);

  pen.write('Votre bon comprend :', {
    font: F.bold, size: 9.5, gap: 2,
  });
  contentLines(voucher).slice(0, 7).forEach((line) => {
    pen.write(`• ${line}`, {
      font: F.regular, size: 8.5, color: INK, maxLines: 2, gap: 1,
    });
  });
  state.y += mm(1.5);

  const parties = [voucher.recipientName && `Pour ${voucher.recipientName}`, voucher.senderName && `de la part de ${voucher.senderName}`].filter(Boolean).join(' ');
  if (parties) pen.write(parties, { font: F.bold, size: 9.5, maxLines: 2, gap: 1 });
  if (voucher.message) pen.write(voucher.message, { font: F.italic, size: 8.5, maxLines: 4, gap: 1 });
  state.y += mm(2);

  pen.write('Votre code', {
    font: F.regular, size: 7.5, color: MUTED, align: 'center', gap: 1,
  });
  pen.write(code.format(voucher.code), {
    font: F.bold, size: 15, align: 'center', gap: 3, spacing: 0.5,
  });
  pen.write(`Valable jusqu’au ${rules.formatFrDate(voucher.expiresOn)}`, {
    font: F.regular, size: 9, align: 'center',
  });
  drawFooter(pen, { company, F });
  drawLegalMention(sheet, F);
  return state.y;
}

function drawCodeBox(pen) {
  const { doc, state } = pen;
  const top = state.y;
  doc.save().roundedRect(pen.left, top, pen.width, CODE_BOX_HEIGHT, 4).lineWidth(0.8).fillAndStroke('#ffffff', LINE).restore();
  doc.font(pen.F.regular).fontSize(7).fillColor(MUTED).text('Code du bon', pen.left + 6, top + 4, { lineBreak: false });
  const gap = mm(2.5);
  const cells = 4;
  const cellW = (pen.width - 12 - gap * (cells - 1)) / cells;
  const cellH = CODE_BOX_HEIGHT - 20;
  for (let i = 0; i < cells; i += 1) {
    doc.save().roundedRect(pen.left + 6 + i * (cellW + gap), top + 14, cellW, cellH, 3).lineWidth(0.6).strokeColor(GUIDE).stroke().restore();
  }
  state.y = top + CODE_BOX_HEIGHT + mm(2);
}

function drawMerchantBack(sheet, {
  F, company, validityMonths, url, link, useLink, qrModules,
}) {
  sheet.doc.addPage({ size: [sheet.width, sheet.height], margin: 0 });
  const pen = createPen(sheet, F);
  const { doc, state } = pen;
  drawHeader(pen, { company, F });
  pen.write('Pour offrir ce bon', {
    font: F.serif, size: 17, align: 'center', gap: 6,
  });

  const qrTop = state.y;
  drawQr(doc, qrModules(url), pen.left, qrTop, QR_SIZE);
  const sideX = pen.left + QR_SIZE + mm(3);
  const sideW = pen.right - sideX;
  const step = (n, text, x, w) => {
    pen.write(`${n}  ${text}`, {
      font: F.bold, size: 9, x, w, maxLines: 2, gap: 3,
    });
  };
  state.y = qrTop + 2;
  step(1, STEPS[0], sideX, sideW);
  step(2, STEPS[1], sideX, sideW);
  pen.write(link, {
    font: F.regular, size: 8, color: MUTED, x: sideX, w: sideW, maxLines: 2,
  });
  state.y = Math.max(state.y, qrTop + QR_SIZE) + mm(2.5);

  step(3, STEPS[2], pen.left, pen.width);
  drawCodeBox(pen);
  step(4, STEPS[3], pen.left, pen.width);

  const inset = `Vous avez reçu cette carte ? Rendez-vous sur ${useLink} et saisissez le code ci-dessus pour réserver.`;
  doc.font(F.regular).fontSize(8.5);
  const lines = fitLines(doc, inset, pen.width - 16, 4);
  const boxHeight = lines.length * doc.currentLineHeight() + 12;
  doc.save().roundedRect(pen.left, state.y, pen.width, boxHeight, 4).lineWidth(0.8).strokeColor(INK).stroke().restore();
  state.y += 6;
  pen.write(inset, {
    font: F.regular, size: 8.5, x: pen.left + 8, w: pen.width - 16, maxLines: 4, gap: 0,
  });
  state.y += 6 + mm(2);

  pen.write(`Valable ${validityMonths} mois à partir du paiement.`, {
    font: F.regular, size: 9, align: 'center',
  });
  drawFooter(pen, { company, F });
  drawLegalMention(sheet, F);
  return state.y;
}

const prepare = (sheet) => sdk.coreModule('pdfFonts').registerFaces(sheet.doc);

/**
 * Rules 21, 22, 49, 50 — the voucher: its front, then its back. `voucher` carries the normalised `code`, its contents, parties, message and expiry; `front` is the bytes of the
 * frozen visual version (null → a plain front); `company` is `{ name, town, website, logo }`. `qr(url)` answers the QR modules and is injectable so a suite reads what the code
 * points at. → a Buffer holding the PDF.
 */
async function renderVoucherPdf({
  voucher, front = null, company, origin, linkBase,
}, { qr = defaultQr } = {}) {
  const sheet = createSheet({ title: `Bon cadeau ${voucher.number}` });
  const F = prepare(sheet);
  drawFront(sheet, { image: front, F, companyName: company.name });
  drawVoucherBack(sheet, {
    F,
    company,
    voucher,
    url: redeemUrl({ origin, linkBase }, voucher.code),
    link: shortLink(redeemUrl({ origin, linkBase })),
    qrModules: qr,
  });
  sheet.doc.end();
  return sheet.done;
}

/**
 * Rules 33, 34, 49, 50 — the merchant card a printer produces: the same two pages with crop marks outside the trim, no number and no amount. `campaign` is `{ slug, validityMonths }`;
 * `front` the bytes of the campaign's merchant visual.
 */
async function renderMerchantCardPdf({
  campaign, front = null, company, origin, linkBase,
}, { qr = defaultQr } = {}) {
  const sheet = createSheet({ title: `Carte commerçant ${company.name}`, slug: SLUG, marks: true });
  const F = prepare(sheet);
  drawFront(sheet, { image: front, F, companyName: company.name });
  drawMerchantBack(sheet, {
    F,
    company,
    validityMonths: campaign.validityMonths,
    url: offerUrl({ origin, linkBase }, campaign.slug),
    link: shortLink(offerUrl({ origin, linkBase }, campaign.slug)),
    useLink: shortLink(redeemUrl({ origin, linkBase })),
    qrModules: qr,
  });
  drawCropMarks(sheet);
  sheet.doc.end();
  return sheet.done;
}

module.exports = {
  renderVoucherPdf, renderMerchantCardPdf, redeemUrl, offerUrl, shortLink, fitLines, CODE_BOX_HEIGHT, LEGAL_MENTION, STEPS,
};
