/**
 * The printed cards of the plugin (specs/gift-voucher-campaigns.md rules 21, 22, 33, 34, 49, 50; the backs redrawn by specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 18-21):
 * the voucher the giver receives and the merchant card a printer produces. Both are A6 portrait, 105 × 148 mm, with a 3 mm bleed, two pages — the front, then the back. The front is
 * the visual picked in the library, embedded as uploaded (never resampled) and scaled to cover the bleed; on the merchant card GuestFlow adds the « à partir de » price in the corner
 * the campaign chose. The back is drawn here on a white ground, text and QR code as vectors with the fonts embedded: the company's logo or name, « BON CADEAU », a title and a
 * subtitle, the QR code in a rounded frame, three numbered steps and one rectangle for the code (the voucher's is printed in it, the merchant card's is left empty to copy it into).
 * Every printed back carries the legal mention along its right edge and the company at its foot (rule 50). Every free text is wrapped by hand inside its box. The same drawing serves
 * the print sheets (`renderPrintSheets`): a card is drawn in a translated and scaled frame of the page.
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const sdk = require('../sdk');
const code = require('./code');
const rules = require('./voucherRules');
const { contentLines } = require('./contentsText');

/**
 * Rule 66 — every dimension of the back, written once: the PDF draws from it and the website sends it as is, so its HTML copy of the back cannot drift from the PDF without a test
 * failing. Millimetres on the A6 trim (105 × 148), sizes and small gaps in points, `lines` the most lines a text may take.
 */
const BACK_LAYOUT = Object.freeze({
  trimMm: Object.freeze({ width: 105, height: 148 }),
  safeMm: 5,
  legalStripMm: 5,
  qrMm: 23,
  qrFramePadMm: 2.5,
  logoMm: 12,
  footerLineMm: 4,
  discMm: 4.6,
  stepGapMm: 2,
  codeBoxMm: 16,
  afterQrMm: 3,
  afterStepsMm: 3,
  afterCodeMm: 2,
  // pdfkit's line pitch for the faces, in ems: the page sets its lines at the same pitch.
  lineHeight: Object.freeze({ sans: 1.326, serif: 1.371 }),
  pt: Object.freeze({
    logoGap: 6, logoName: 12, kicker: 8, kickerSpacing: 2.4, kickerGap: 3, title: 17, titleGap: 2, subtitle: 9, subtitleGap: 7, frameStroke: 1.1, scan: 8.5, scanGap: 1, link: 7.5, linkGap: 6,
    step: 8.5, discNumber: 8, codeLabel: 6.5, code: 15, codeSpacing: 0.8, small: 7.5, smallGap: 2, footer: 8, legal: 7
  }),
  lines: Object.freeze({
    logoName: 2, title: 2, subtitle: 2, step: 1, link: 1, includes: 3, message: 2,
  }),
});

// The « à partir de » label of the merchant card's front: the front is not drawn by the website, so its sizes are not part of the back's layout.
const FRONT_PRICE_PT = Object.freeze({ small: 8.5, price: 19 });

const MM = 72 / 25.4;
const mm = (n) => n * MM;
const TRIM = Object.freeze({ width: mm(BACK_LAYOUT.trimMm.width), height: mm(BACK_LAYOUT.trimMm.height) });
const BLEED = mm(3);
const SAFE = mm(BACK_LAYOUT.safeMm);
const SLUG = mm(5);
const MARK_LENGTH = mm(4);
const LEGAL_MENTION = 'Ne pas jeter sur la voie publique.';
/**
 * Rule 66 — the fixed words of the backs, French as the PDF is: the website writes these and nothing else of its own. `{…}` is filled by the page with what the buyer typed.
 * `voucher` is the voucher's back (rule 20), `merchant` the merchant card's (rule 19).
 */
const BACK_TEXTS = Object.freeze({
  title: 'BON CADEAU',
  lodgingTitle: 'Un séjour offert',
  subtitle: 'offert par {sender} à {recipient}',
  subtitleSender: 'offert par {sender}',
  subtitleRecipient: 'offert à {recipient}',
  scan: 'Scannez le QR code',
  steps: Object.freeze(['Scannez le QR code avec votre téléphone', 'Choisissez votre créneau en ligne', 'Savourez votre parenthèse en Ardèche']),
  // A voucher for a stay is not used on « Mon bain »: its page points to the booking page, where the code fills itself in (rule 20).
  lodgingSteps: Object.freeze(['Scannez le QR code avec votre téléphone', 'Réservez votre séjour en ligne : le code se remplit tout seul', 'Savourez votre parenthèse en Ardèche']),
  codeLabel: 'Code du bon',
  // The dash, not a colon: the first line of the contents already has one (« Bain nordique : 1 h en journée · week-end »).
  includes: 'Votre bon comprend — {lines}',
  bullet: '•',
  recipient: 'Pour {name}',
  sender: 'de la part de {name}',
  codePlaceholder: 'XXXX-XXXX-XXXX-XXXX',
  validUntil: 'Valable jusqu’au {date}',
  legal: LEGAL_MENTION,
  merchant: Object.freeze({
    title: 'Offrez un bon cadeau',
    subtitle: 'en quelques minutes, depuis votre téléphone',
    steps: Object.freeze(['Scannez le QR code avec votre téléphone', 'Choisissez et réglez le bon sur notre site', 'Recopiez ci-dessous le code reçu par mail, offrez la carte']),
    validFor: 'Valable {months} mois à partir du paiement.',
    received: 'Vous avez reçu cette carte ? {link}',
  }),
  frontPrice: Object.freeze({ from: 'à partir de' }),
});
const INK = '#1f2a24';
const MUTED = '#5c665f';
const LINE = '#c9cfc9';
const HONEY = '#b9822f';
const FIR = '#2f5d50';
const QR_SIZE = mm(BACK_LAYOUT.qrMm);
// The strip along the right edge that the vertical legal mention occupies, inside the safe area.
const LEGAL_STRIP = mm(BACK_LAYOUT.legalStripMm);
const CODE_BOX_HEIGHT = mm(BACK_LAYOUT.codeBoxMm);

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

/**
 * Text on one line, placed by hand: pdfkit wraps a text drawn with a width (even with `lineBreak: false`) at its hyphens and spaces, which would drop a long link or a name onto
 * the line below. `align` is `left`, `center` or `right` inside `[x, x + width]`.
 */
function plainText(doc, str, x, y, { width = null, align = 'left', characterSpacing = 0 } = {}) {
  let at = x;
  if (width !== null && align !== 'left') {
    const used = doc.widthOfString(str, { characterSpacing });
    at = align === 'center' ? x + (width - used) / 2 : x + width - used;
  }
  return doc.text(str, at, y, { lineBreak: false, characterSpacing });
}

/** An image opened once per document: embedded once however many cards of a print sheet use it. */
function imageOf(doc, bytes) {
  if (!doc.gfImages) doc.gfImages = new Map();
  if (!doc.gfImages.has(bytes)) doc.gfImages.set(bytes, doc.openImage(bytes));
  return doc.gfImages.get(bytes);
}

/** A document and the promise of its bytes. */
function newDocument({ title, width, height }) {
  const doc = new PDFDocument({
    size: [width, height], margin: 0, info: { Title: title },
  });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, done };
}

/** The geometry of one card on a page of its own size (or translated and scaled into a print sheet): the trim box, the safe frame, the slug of a merchant card's crop marks. */
function cardSheet(doc, { slug = 0, marks = false } = {}) {
  const width = TRIM.width + 2 * BLEED + 2 * slug;
  const height = TRIM.height + 2 * BLEED + 2 * slug;
  const trim = {
    left: slug + BLEED, top: slug + BLEED, right: slug + BLEED + TRIM.width, bottom: slug + BLEED + TRIM.height,
  };
  const safe = {
    left: trim.left + SAFE, top: trim.top + SAFE, right: trim.right - SAFE, bottom: trim.bottom - SAFE,
  };
  return {
    doc, width, height, trim, slug, marks, safe,
  };
}

/** One drawing surface: the document, its faces, and the safe frame the back is drawn in. */
function createSheet({
  title, slug = 0, marks = false,
}) {
  const probe = cardSheet(null, { slug, marks });
  const { doc, done } = newDocument({ title, width: probe.width, height: probe.height });
  return { ...cardSheet(doc, { slug, marks }), done };
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

/**
 * The front: the picked visual as uploaded, scaled to cover the bleed box and cropped to it (a print sheet clips each card to its trim, so a card of a sheet is the same crop as the
 * single PDF's); with none picked, a plain card with the company's name.
 */
function drawFront(sheet, { image, F, companyName }) {
  const { doc, slug, trim } = sheet;
  const box = { x: slug, y: slug, w: TRIM.width + 2 * BLEED, h: TRIM.height + 2 * BLEED };
  if (image) {
    const picture = imageOf(doc, image);
    const scale = Math.max(box.w / picture.width, box.h / picture.height);
    const w = picture.width * scale;
    const h = picture.height * scale;
    doc.save().rect(box.x, box.y, box.w, box.h).clip();
    doc.image(picture, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, { width: w, height: h });
    doc.restore();
  } else {
    doc.save().rect(box.x, box.y, box.w, box.h).clip();
    doc.rect(box.x, box.y, box.w, box.h).fill('#f4f1ea');
    doc.font(F.serif).fontSize(22).fillColor(INK);
    plainText(doc, companyName, trim.left + SAFE, trim.top + TRIM.height / 2 - 14, { width: TRIM.width - 2 * SAFE, align: 'center' });
    doc.restore();
  }
  if (sheet.marks) drawCropMarks(sheet);
}

/** Rule 21 of the week-weekend spec — the « à partir de » label GuestFlow draws over the merchant card's visual, in the corner the campaign chose, inside the safe area. */
function drawFrontPrice(sheet, F, { cents, position }) {
  if (!cents || position === 'none' || !rules.FRONT_PRICE_POSITIONS.includes(position)) return;
  const { doc, safe } = sheet;
  const small = BACK_TEXTS.frontPrice.from;
  const price = `${cents % 100 === 0 ? String(cents / 100) : rules.formatEuros(cents).replace(' €', '')} €`;
  doc.font(F.regular).fontSize(FRONT_PRICE_PT.small);
  const smallW = doc.widthOfString(small);
  const smallH = doc.currentLineHeight();
  doc.font(F.serif).fontSize(FRONT_PRICE_PT.price);
  const priceW = doc.widthOfString(price);
  const priceH = doc.currentLineHeight();
  const padX = mm(4);
  const padY = mm(2);
  const w = Math.max(smallW, priceW) + 2 * padX;
  const h = smallH + priceH + 2 * padY;
  const x = position.endsWith('left') ? safe.left : safe.right - w;
  const y = position.startsWith('top') ? safe.top : safe.bottom - h;
  doc.save().roundedRect(x, y, w, h, mm(3)).fill('#ffffff').restore();
  doc.font(F.regular).fontSize(FRONT_PRICE_PT.small).fillColor(FIR);
  plainText(doc, small, x, y + padY, { width: w, align: 'center' });
  doc.font(F.serif).fontSize(FRONT_PRICE_PT.price).fillColor(FIR);
  plainText(doc, price, x, y + padY + smallH, { width: w, align: 'center' });
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
      plainText(doc, line, x, y, { width: w, align, characterSpacing: spacing });
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
  const height = mm(BACK_LAYOUT.logoMm);
  const { pt } = BACK_LAYOUT;
  if (company.logo) {
    try {
      doc.image(imageOf(doc, company.logo), pen.left, pen.state.y, {
        fit: [pen.width, height], align: 'center', valign: 'center',
      });
      pen.state.y += height + pt.logoGap;
      return;
    } catch {
      // a logo pdfkit cannot read leaves the name instead
    }
  }
  pen.write(company.name, {
    font: F.serif, size: pt.logoName, align: 'center', maxLines: BACK_LAYOUT.lines.logoName, gap: pt.logoGap, color: MUTED,
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
  const size = BACK_LAYOUT.pt.legal;
  doc.font(F.regular).fontSize(size).fillColor(MUTED);
  const length = doc.widthOfString(LEGAL_MENTION);
  const cx = safe.right - LEGAL_STRIP / 2;
  const cy = (safe.top + safe.bottom) / 2;
  doc.save().rotate(90, { origin: [cx, cy] });
  doc.text(LEGAL_MENTION, cx - length / 2, cy - size / 2, { lineBreak: false });
  doc.restore();
}

/** Rule 18 — « <company> · <town> · <department> », italic and honey, centred at the foot of the back. */
function drawFooter(pen, { company, F }) {
  const bottom = pen.safe.bottom;
  const identity = [company.name, company.town, company.department].filter(Boolean).join(' · ');
  const wasY = pen.state.y;
  pen.state.y = bottom - mm(BACK_LAYOUT.footerLineMm);
  pen.write(identity, {
    font: F.italic, size: BACK_LAYOUT.pt.footer, align: 'center', color: HONEY, maxLines: 1, stay: true,
  });
  pen.state.y = wasY;
}

/** The numbered honey discs and their one line each. */
function drawSteps(pen, steps) {
  const { doc, state } = pen;
  const { pt } = BACK_LAYOUT;
  const disc = mm(BACK_LAYOUT.discMm);
  steps.forEach((text, index) => {
    const top = state.y;
    doc.save().circle(pen.left + disc / 2, top + disc / 2, disc / 2).fill(HONEY).restore();
    doc.font(pen.F.bold).fontSize(pt.discNumber).fillColor('#ffffff');
    plainText(doc, String(index + 1), pen.left, top + (disc - doc.currentLineHeight()) / 2 + 0.4, { width: disc, align: 'center' });
    state.y = top + (disc - doc.font(pen.F.regular).fontSize(pt.step).currentLineHeight()) / 2;
    pen.write(text, {
      font: pen.F.regular, size: pt.step, x: pen.left + disc + mm(2.5), w: pen.width - disc - mm(2.5), maxLines: BACK_LAYOUT.lines.step, gap: 0,
    });
    state.y = top + disc + mm(BACK_LAYOUT.stepGapMm);
  });
}

/** The one rectangle of the code, « Code du bon » inside at its top left; the voucher's code is printed in it, the merchant card's rectangle stays empty. */
function drawCodeBox(pen, printed) {
  const { doc, state } = pen;
  const { pt } = BACK_LAYOUT;
  const top = state.y;
  doc.save().roundedRect(pen.left, top, pen.width, CODE_BOX_HEIGHT, mm(1.5)).lineWidth(0.9).fillAndStroke('#ffffff', HONEY).restore();
  doc.font(pen.F.regular).fontSize(pt.codeLabel).fillColor(MUTED).text(BACK_TEXTS.codeLabel, pen.left + mm(2.5), top + mm(2), { lineBreak: false });
  if (printed) {
    doc.font(pen.F.bold).fontSize(pt.code).fillColor(INK);
    plainText(doc, printed, pen.left, top + (CODE_BOX_HEIGHT - doc.currentLineHeight()) / 2 + mm(1), { width: pen.width, align: 'center', characterSpacing: pt.codeSpacing });
  }
  state.y = top + CODE_BOX_HEIGHT + mm(BACK_LAYOUT.afterCodeMm);
}

/**
 * Rules 18-20 — the one back, for the voucher and for the merchant card: `spec` is `{ title, subtitle, steps, url, link, printedCode, small: [{ text, font, color, lines }] }`.
 * The small lines under the code stop where the foot of the page begins.
 */
function drawBack(sheet, {
  F, company, spec, qrModules,
}) {
  const pen = createPen(sheet, F);
  const { doc, state } = pen;
  const { pt, lines: most } = BACK_LAYOUT;
  drawHeader(pen, { company, F });
  pen.write(BACK_TEXTS.title, {
    font: F.bold, size: pt.kicker, align: 'center', color: HONEY, spacing: pt.kickerSpacing, gap: pt.kickerGap,
  });
  pen.write(spec.title, {
    font: F.serif, size: pt.title, align: 'center', maxLines: most.title, gap: pt.titleGap,
  });
  if (spec.subtitle) {
    pen.write(spec.subtitle, {
      font: F.italic, size: pt.subtitle, align: 'center', color: MUTED, maxLines: most.subtitle, gap: pt.subtitleGap,
    });
  } else {
    state.y += pt.subtitleGap;
  }
  const frame = QR_SIZE + 2 * mm(BACK_LAYOUT.qrFramePadMm);
  const frameLeft = pen.left + (pen.width - frame) / 2;
  doc.save().roundedRect(frameLeft, state.y, frame, frame, mm(2.5)).lineWidth(pt.frameStroke).strokeColor(HONEY).stroke().restore();
  drawQr(doc, qrModules(spec.url), frameLeft + mm(BACK_LAYOUT.qrFramePadMm), state.y + mm(BACK_LAYOUT.qrFramePadMm), QR_SIZE);
  state.y += frame + mm(BACK_LAYOUT.afterQrMm);
  pen.write(BACK_TEXTS.scan, {
    font: F.bold, size: pt.scan, align: 'center', gap: pt.scanGap,
  });
  pen.write(spec.link, {
    font: F.regular, size: pt.link, align: 'center', color: MUTED, maxLines: most.link, gap: pt.linkGap,
  });
  drawSteps(pen, spec.steps);
  state.y += mm(BACK_LAYOUT.afterStepsMm) - mm(BACK_LAYOUT.stepGapMm);
  drawCodeBox(pen, spec.printedCode);
  // The small lines under the code stop where the foot of the page begins. When room runs out the lines of lower priority give way, never the validity (rule 20, Q5):
  // the room is shared out by priority (the spec's `priority`, lowest first; the order of the list by default) and the lines are drawn in the order of the list.
  const floor = pen.safe.bottom - mm(BACK_LAYOUT.footerLineMm) - mm(1.5);
  let room = floor - state.y;
  const wanted = spec.small.map((line, index) => ({ line, index, priority: line.priority === undefined ? index : line.priority }));
  const allowed = new Map();
  wanted.filter(({ line }) => line.text).sort((a, b) => a.priority - b.priority).forEach(({ line, index }) => {
    doc.font(line.font).fontSize(pt.small);
    const height = doc.currentLineHeight();
    const need = fitLines(doc, line.text, pen.width, line.lines).length;
    const fit = Math.max(0, Math.min(need, Math.floor((room - pt.smallGap) / height)));
    allowed.set(index, fit);
    if (fit > 0) room -= fit * height + pt.smallGap;
  });
  wanted.forEach(({ line, index }) => {
    if (!allowed.get(index)) return;
    pen.write(line.text, {
      font: line.font, size: pt.small, color: line.color || INK, align: 'center', maxLines: allowed.get(index), gap: pt.smallGap,
    });
  });
  drawFooter(pen, { company, F });
  drawLegalMention(sheet, F);
  return state.y;
}

const say = (template, values) => Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, () => value), template);

/** Rule 20 — the three steps of a voucher's back: those of a session voucher, or of a stay voucher (which is used on the booking page of a lodging). */
const stepsOf = (contents) => (contents && contents.kind === 'lodging' ? BACK_TEXTS.lodgingSteps : BACK_TEXTS.steps);

/** Rule 20 — what the voucher's back says: the campaign's public title, who gave it to whom, the three steps, the printed code, the contents, the message and the end of its validity. */
function voucherBackSpec({
  F, voucher, url, link,
}) {
  const contents = rules.contentsOf(voucher);
  const title = contents && contents.title ? contents.title : BACK_TEXTS.lodgingTitle;
  const sender = voucher.senderName;
  const recipient = voucher.recipientName;
  let subtitle = '';
  if (sender && recipient) subtitle = say(BACK_TEXTS.subtitle, { sender, recipient });
  else if (sender) subtitle = say(BACK_TEXTS.subtitleSender, { sender });
  else if (recipient) subtitle = say(BACK_TEXTS.subtitleRecipient, { recipient });
  return {
    title,
    subtitle,
    steps: stepsOf(contents),
    url,
    link,
    printedCode: code.format(voucher.code),
    small: [
      { text: say(BACK_TEXTS.includes, { lines: contentLines(voucher).join(' · ') }), font: F.regular, lines: BACK_LAYOUT.lines.includes, priority: 2 },
      { text: voucher.message, font: F.italic, color: MUTED, lines: BACK_LAYOUT.lines.message, priority: 1 },
      { text: say(BACK_TEXTS.validUntil, { date: rules.formatFrDate(voucher.expiresOn) }), font: F.bold, lines: 1, priority: 0 },
    ],
  };
}

/** Rule 19 — the merchant card's back: the title and the steps of the offer, the rectangle left empty, the validity and where a card received is used. */
function merchantBackSpec({
  F, validityMonths, url, link, useLink,
}) {
  const t = BACK_TEXTS.merchant;
  return {
    title: t.title,
    subtitle: t.subtitle,
    steps: t.steps,
    url,
    link,
    printedCode: null,
    small: [
      { text: say(t.validFor, { months: String(validityMonths) }), font: F.regular, lines: 1 },
      { text: say(t.received, { link: useLink }), font: F.regular, color: MUTED, lines: 2 },
    ],
  };
}

const prepare = (sheet) => sdk.coreModule('pdfFonts').registerFaces(sheet.doc);
const addPageOf = (sheet) => sheet.doc.addPage({ size: [sheet.width, sheet.height], margin: 0 });

/**
 * Rules 21, 22, 49, 50 — the voucher: its front, then its back. `voucher` carries the normalised `code`, its contents, parties, message and expiry; `front` is the bytes of the
 * frozen visual version (null → a plain front); `company` is `{ name, town, department, website, logo }`. `qr(url)` answers the QR modules and is injectable so a suite reads what
 * the code points at. → a Buffer holding the PDF.
 */
async function renderVoucherPdf({
  voucher, front = null, company, origin, linkBase,
}, { qr = defaultQr } = {}) {
  const sheet = createSheet({ title: `Bon cadeau ${voucher.number}` });
  const F = prepare(sheet);
  drawFront(sheet, { image: front, F, companyName: company.name });
  addPageOf(sheet);
  drawBack(sheet, {
    F, company, qrModules: qr, spec: voucherBackSpec({ F, voucher, url: redeemUrl({ origin, linkBase }, voucher.code), link: shortLink(redeemUrl({ origin, linkBase })) }),
  });
  sheet.doc.end();
  return sheet.done;
}

/**
 * Rules 33, 34, 49, 50 and rule 21 of the week-weekend spec — the merchant card a printer produces: the same two pages with crop marks outside the trim, no number and no amount, the
 * price of the campaign in the corner it chose. `campaign` is `{ slug, validityMonths, frontPricePosition }`; `front` the bytes of the campaign's merchant visual; `fromCents` the
 * lowest price the campaign offers today (none for a lodging campaign).
 */
async function renderMerchantCardPdf({
  campaign, front = null, company, origin, linkBase, fromCents = null,
}, { qr = defaultQr } = {}) {
  const sheet = createSheet({ title: `Carte commerçant ${company.name}`, slug: SLUG, marks: true });
  const F = prepare(sheet);
  drawFront(sheet, { image: front, F, companyName: company.name });
  drawFrontPrice(sheet, F, { cents: fromCents, position: campaign.frontPricePosition || 'bottom-right' });
  addPageOf(sheet);
  drawBack(sheet, { F, company, qrModules: qr, spec: merchantBackSpec({
    F,
    validityMonths: campaign.validityMonths,
    url: offerUrl({ origin, linkBase }, campaign.slug),
    link: shortLink(offerUrl({ origin, linkBase }, campaign.slug)),
    useLink: shortLink(redeemUrl({ origin, linkBase })),
  }) });
  drawCropMarks(sheet);
  sheet.doc.end();
  return sheet.done;
}

const MM_TO_PT = mm(1);

/** The dotted fold line of a pair (side by side), in the sheet's own points. */
function drawFolds(doc, folds) {
  doc.save().lineWidth(0.4).strokeColor('#000000').dash(2, { space: 2 });
  folds.forEach((fold) => doc.moveTo(fold.x1 * MM_TO_PT, fold.y1 * MM_TO_PT).lineTo(fold.x2 * MM_TO_PT, fold.y2 * MM_TO_PT).stroke());
  doc.undash().restore();
}

/** The crop marks the layout planned, at the cut lines of the grid and inside the printable area. */
function drawSheetMarks(doc, marks) {
  doc.save().lineWidth(0.25).strokeColor('#000000');
  marks.forEach((mark) => doc.moveTo(mark.x1 * MM_TO_PT, mark.y1 * MM_TO_PT).lineTo(mark.x2 * MM_TO_PT, mark.y2 * MM_TO_PT).stroke());
  doc.restore();
}

/**
 * Rules 24-26 — print sheets: `layout` is `printLayout.plan(...).layout`. Each cell of each page is the card's front or back drawn in a frame of the page (translated to the cell, scaled to
 * the layout's scale); the fronts are cropped to the trim, the backs are white. `draw` is `{ front(sheet, F), back(sheet, F) }`, the card's own two drawings on a card geometry.
 * → a Buffer holding the PDF, one page per page of the layout.
 */
async function renderPrintSheets({ layout, title, draw }) {
  const first = layout.pages[0].sheet;
  const { doc, done } = newDocument({ title, width: first.widthMm * MM_TO_PT, height: first.heightMm * MM_TO_PT });
  const F = sdk.coreModule('pdfFonts').registerFaces(doc);
  layout.pages.forEach((page, index) => {
    if (index > 0) doc.addPage({ size: [page.sheet.widthMm * MM_TO_PT, page.sheet.heightMm * MM_TO_PT], margin: 0 });
    page.cells.forEach((cell) => {
      const card = cardSheet(doc);
      const scale = (cell.widthMm * MM_TO_PT) / TRIM.width;
      doc.save();
      // A back to be read upright once the sheet is turned like a calendar page (rule 24) is drawn half a turn round the centre of its cell.
      if (cell.rotateDeg) doc.rotate(cell.rotateDeg, { origin: [(cell.xMm + cell.widthMm / 2) * MM_TO_PT, (cell.yMm + cell.heightMm / 2) * MM_TO_PT] });
      doc.translate(cell.xMm * MM_TO_PT - card.trim.left * scale, cell.yMm * MM_TO_PT - card.trim.top * scale);
      doc.scale(scale);
      doc.rect(card.trim.left, card.trim.top, TRIM.width, TRIM.height).clip();
      if (cell.face === 'front') draw.front(card, F);
      else draw.back(card, F);
      doc.restore();
    });
    drawFolds(doc, page.folds);
    drawSheetMarks(doc, page.marks);
  });
  doc.end();
  return done;
}

/** The drawings of a voucher and of a merchant card on a card geometry, for `renderPrintSheets`. */
function voucherDrawing({
  voucher, front = null, company, origin, linkBase,
}, { qr = defaultQr } = {}) {
  return {
    front: (card, F) => drawFront(card, { image: front, F, companyName: company.name }),
    back: (card, F) => drawBack(card, {
      F, company, qrModules: qr, spec: voucherBackSpec({ F, voucher, url: redeemUrl({ origin, linkBase }, voucher.code), link: shortLink(redeemUrl({ origin, linkBase })) }),
    }),
  };
}

function merchantDrawing({
  campaign, front = null, company, origin, linkBase, fromCents = null,
}, { qr = defaultQr } = {}) {
  return {
    front: (card, F) => {
      drawFront(card, { image: front, F, companyName: company.name });
      drawFrontPrice(card, F, { cents: fromCents, position: campaign.frontPricePosition || 'bottom-right' });
    },
    back: (card, F) => drawBack(card, {
      F, company, qrModules: qr, spec: merchantBackSpec({
        F,
        validityMonths: campaign.validityMonths,
        url: offerUrl({ origin, linkBase }, campaign.slug),
        link: shortLink(offerUrl({ origin, linkBase }, campaign.slug)),
        useLink: shortLink(redeemUrl({ origin, linkBase })),
      }),
    }),
  };
}

module.exports = {
  renderVoucherPdf,
  renderMerchantCardPdf,
  renderPrintSheets,
  voucherDrawing,
  merchantDrawing,
  redeemUrl,
  offerUrl,
  shortLink,
  fitLines,
  FRONT_PRICE_PT,
  CODE_BOX_HEIGHT,
  LEGAL_MENTION,
  BACK_LAYOUT,
  BACK_TEXTS,
};
