/**
 * Devis PDF renderer — pure presentation. Takes an enriched devis (`full`, incl. property/client/options/
 * resources/nights) + app `settings` and returns the PDF as a Buffer. No DB access. Extracted verbatim
 * from the former routes/devis.js GET /:id/pdf so the output is byte-identical.
 */

const { todayIso: localTodayIso } = require('./localDate');
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const {
  roundMoney, formatDateFR, formatDateLocalised, formatCurrency, isLineOffered,
  resolveExtraGuestPdfRow, timeToDecimalHour, formatHoursLabel, diffDays, addDaysToIsoDate, formatDate,
} = require("./devisHelpers");
const { labels } = require("./devisPdfLabels");
const { isDirectChannel } = require("./platformNameFormat");
const { uploadsDir } = require("./instancePaths");

// specs/ui-review-2026-10-19-operations.md rule 17 — the « Maison » tokens of client/src/theme.js:
// fir green, ink, warm paper, honey and the success soft fill. No navy left.
const PDF_PALETTE = Object.freeze({
  brand: '#2F5D46',
  ink: '#27251F',
  muted: '#6E6A5E',
  paper: '#F6F3EC',
  rule: '#DDD6C8',
  offered: '#3E7D54',
  offeredSoft: '#E6EFE7',
  honey: '#F6EDD7',
});

// The serif of the app (Source Serif 4, SIL Open Font License), embedded so the document reads in the
// same voice on every machine: its Latin subset, plus the Latin Extended one (Ł, ą, ğ, č…) for the
// names of customers outside France. A missing file falls back to the PDF standard serif.
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const SERIF_FACES = [
  { name: 'MaisonSerif', file: path.join(FONT_DIR, 'SourceSerif4-Semibold.woff') },
  { name: 'MaisonSerifExt', file: path.join(FONT_DIR, 'SourceSerif4-Semibold-LatinExt.woff') },
];
const STANDARD_BOLD = 'Helvetica-Bold';

function registerSerif(doc) {
  try {
    const present = SERIF_FACES.filter((f) => fs.existsSync(f.file));
    if (present.length === 0) return 'Times-Bold';
    present.forEach((f) => doc.registerFont(f.name, f.file));
    return 'MaisonSerif';
  } catch {
    return 'Times-Bold';
  }
}

// Which glyphs each embedded face can draw, read once from the fonts themselves.
let faceCoverage;
function coverage() {
  if (faceCoverage !== undefined) return faceCoverage;
  try {
    const fontkit = require('fontkit');
    faceCoverage = SERIF_FACES.filter((f) => fs.existsSync(f.file)).map((f) => ({ name: f.name, font: fontkit.openSync(f.file) }));
  } catch {
    faceCoverage = [];
  }
  return faceCoverage;
}

/**
 * A text cut into runs, each drawn by the first serif face that has all its glyphs — the Latin one,
 * then the Latin Extended one — or by the standard bold of the rest of the document as a last resort
 * (rule 17). Whitespace stays with the run it sits in. Pure (reads the font files once).
 */
function serifRuns(text) {
  const faces = coverage();
  const faceOf = (ch) => {
    if (/\s/.test(ch)) return null;
    const face = faces.find((f) => f.font.hasGlyphForCodePoint(ch.codePointAt(0)));
    return face ? face.name : STANDARD_BOLD;
  };
  const runs = [];
  for (const ch of String(text || '')) {
    const face = faceOf(ch);
    const last = runs[runs.length - 1];
    if (last && (face === null || face === last.font)) last.text += ch;
    else runs.push({ font: face || (faces[0] ? faces[0].name : STANDARD_BOLD), text: ch });
  }
  return runs;
}

// Draws a serif text run by run, so one name can mix the Latin and Latin Extended faces.
function drawSerifText(doc, serif, text, x, y, options = {}) {
  if (serif !== 'MaisonSerif') {
    doc.font(serif).text(text, x, y, options);
    return;
  }
  const runs = serifRuns(text);
  runs.forEach((run, i) => {
    const last = i === runs.length - 1;
    doc.font(run.font);
    if (i === 0) doc.text(run.text, x, y, { ...options, continued: !last });
    else doc.text(run.text, { continued: !last });
  });
}

// specs/devis-pdf-total-parity.md §3.2 rules 6–10 — single source of truth for the tax + grand-total
// numbers the PDF renders. Two principles, in order:
//
//   1. The document must agree with itself: the grand total is ALWAYS the stay the table actually
//      printed (`printedStayTtc`, the sum of the drawn rows) plus the tax printed above it. A total
//      that matches nothing on the page is the bug this replaces — the user got 595 € under a
//      523,92 € sub-total because the total came from a re-quote of a different pricing state.
//   2. The tax stays engine-authoritative — but only when the engine speaks for THIS document, i.e.
//      when its `finalPrice` reproduces the printed stay. Otherwise the persisted row wins: it is the
//      value the printed lines were computed with.
//
// Amends devis-pdf-and-tourist-tax-fixes.md §3.4 rule 20, which sourced both figures from the quote
// unconditionally. That rule's own bug (PDF tax 15,36 € vs. summary 16,80 €) stays fixed: a quote
// that reconciles still wins. Exported under `__test` so the invariant is provable without parsing
// the FlateDecode-compressed PDF stream.
function resolveLiveTaxTotals(full, quote, printedStayTtc) {
  // Legacy callers render no table and pass nothing — the persisted stay price is their "printed" one.
  const printedStay = roundMoney(Number(printedStayTtc != null ? printedStayTtc : (full.finalPrice || 0)));
  const quoteFinalPrice = quote && quote.finalPrice != null ? Number(quote.finalPrice) : null;
  const quoteReconciles = quoteFinalPrice != null && Math.abs(quoteFinalPrice - printedStay) <= 0.01;
  // A zero `touristTaxTotal` in the quote means "engine didn't compute it", never "no tax" — keep the
  // known-good row rather than silently zeroing a persisted tax.
  const quoteTaxTotal = quote && Number(quote.touristTaxTotal || 0) > 0 ? Number(quote.touristTaxTotal) : null;
  const liveTaxTotal = quoteReconciles && quoteTaxTotal != null
    ? quoteTaxTotal
    : Number(full.touristTaxTotal || 0);
  return {
    liveTaxTotal,
    liveFinalPrice: printedStay,
    grandTotalTtc: roundMoney(printedStay + liveTaxTotal),
    quoteReconciles,
  };
}

// specs/devis-offered-resource-parity.md §3 rules 3-4 — what a line COSTS the client (`billed`, 0 € on
// a geste commercial) vs what it is WORTH (`real`, struck through next to the « Offert » badge). A
// legacy row stored `offered = 1` WITH its phantom price is billed 0 here too, so an old devis prints
// right without waiting for a re-save — and never eats into the accommodation row, whose amount is
// `finalPrice` minus these billed extras. Exported under `__test`.
function lineAmounts(line) {
  const offered = isLineOffered(line);
  const stored = roundMoney(Number(line?.totalPrice || 0));
  const units = Number(line?.billedUnits || line?.quantity || 0);
  const real = roundMoney(Number(line?.originalTotalPrice || 0))
    || roundMoney(Number(line?.unitPrice || 0) * units)
    || stored;
  return { offered, billed: offered ? 0 : stored, real };
}

// specs/devis-pdf-row-layout.md §3 — pure geometry of one pricing-table row. Fed the measured
// heights of what the row actually prints, it answers how tall the row is and where each piece goes
// (offsets from the row's top edge). Row heights used to be a fixed 20 / 28 px, so a designation that
// wrapped bled over the next row's band and the « Offert » badge landed on the label. Exported under
// `__test`: PDFKit encodes text as glyph indexes, so the geometry can only be proven here.
const ROW_PAD_TOP = 7;
const ROW_PAD_BOTTOM = 6;
const ROW_BADGE_GAP = 4;

// A « was » price is struck only above the billed one (specs/review-2026-10-18-reservations.md rule 2).
function showsStruckOriginal(originalTtc, billedTtc) {
  return Number(originalTtc || 0) > Number(billedTtc || 0) + 0.009;
}

function resolveRowGeometry({
  descHeight = 0, badgeHeight = 0, moneyLineHeight = 0, struckLineHeight = 0, showOriginal = false,
} = {}) {
  // The badge owns the line above the label, and takes the whole row down with it.
  const badgeBlock = badgeHeight > 0 ? badgeHeight + ROW_BADGE_GAP : 0;
  // The money column prints two lines when it strikes an original: the "was" price, then the billed one.
  const moneyHeight = showOriginal ? struckLineHeight + moneyLineHeight : moneyLineHeight;
  const lineY = ROW_PAD_TOP + badgeBlock;
  return {
    rowH: Math.ceil(ROW_PAD_TOP + badgeBlock + Math.max(descHeight, moneyHeight) + ROW_PAD_BOTTOM),
    badgeY: ROW_PAD_TOP,
    lineY,
    amountY: showOriginal ? lineY + struckLineHeight : lineY,
  };
}

function generateDevisPdf(full, settings, quote) {
  return new Promise((resolve, reject) => {
  // 2026-06-06 — bilingual rendering (specs/devis-english-language.md). The devis row
  // carries `pdfLanguage` ('fr' default, 'en' opt-in). Every literal goes through `L.<key>`
  // and every date through `fmtDate`. The "at" connector between date + time and the
  // option / resource label fallbacks (FR titles when the EN translation is empty) all
  // live in this same scope so the rest of the function stays readable.
  const language = String(full.pdfLanguage || 'fr').toLowerCase();
  const L = labels(language);
  const fmtDate = (iso) => formatDateLocalised(iso, language);
  const atSeparator = language === 'en' ? 'at' : 'à';
  // Closures bound to the current language; both delegate to the module-level resolvers exposed
  // under `__test` so unit tests can prove the renderer follows the same fallback rules.
  const optionTitle   = (opt) => __resolveOptionTitle(opt, language);
  const resourceName  = (rsc) => __resolveResourceName(rsc, language);

  const property = full.property;
  const client = full.client;
  // Single global VAT rate (specs/single-vat-rate.md §4.1). Applied uniformly to every line:
  // accommodation, options, resources, custom options. The three local bindings stay so the
  // existing `drawRow(..., rate, ...)` call sites read clearly; they all hold the same value.
  const vatRate = Number(settings?.vatRate ?? 10);
  const vatAccommodation = vatRate;
  const vatOptions = vatRate;
  const vatResources = vatRate;

  // Client phone (single column since the Clients bloc).
  const phones = client.phone ? [String(client.phone).trim()] : [];

  // specs/ui-review-2026-10-19-operations.md rule 17 — the « Maison » identity of the app.
  const { brand: BRAND, paper: LIGHT_GRAY, rule: MID_GRAY, ink: TEXT_DARK, muted: TEXT_LIGHT, offered: OFFERED_GREEN } = PDF_PALETTE;

  // `full.__testCompress === false` keeps PDFKit's stream uncompressed so unit tests can grep
  // the raw bytes for English / French labels. Never set in production calls.
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 34, bottom: 34, left: 45, right: 45 },
    bufferPages: true,
    compress: full.__testCompress !== false,
    info: {
      Title: `${L.documentTitle} ${full.devisNumber}`,
      Author: settings.companyName || 'GuestFlow',
    },
  });

  const SERIF = registerSerif(doc);

  // Collect chunks in memory (required with bufferPages:true to support switchToPage)
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  const PAGE_W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const LEFT = doc.page.margins.left;
  const PAGE_H = doc.page.height;
  const MARGIN_TOP = doc.page.margins.top;
  const MARGIN_BOTTOM = doc.page.margins.bottom;
  const RIGHT_PAD = 6; // marge droite pour les textes alignés à droite
  // Reserve 28px at bottom for the per-page footer
  const FOOTER_H = 28;
  const CONTENT_BOTTOM = PAGE_H - MARGIN_BOTTOM - FOOTER_H;

  function checkBreak(currentY, needed = 40) {
    if (currentY + needed > CONTENT_BOTTOM) {
      doc.addPage();
      return MARGIN_TOP;
    }
    return currentY;
  }

  // ── Logo (zone blanche au-dessus de la bande) ────────────────────────────
  const LOGO_H = 60;
  const LOGO_W = 100;
  const HAS_LOGO = settings.companyLogoPath && fs.existsSync(path.join(uploadsDir(), path.basename(settings.companyLogoPath)));
  const BAND_TOP = 40;
  const BAND_HEIGHT = 52;

  // ── Header: serif company name and « DEVIS » on paper, a fir-green rule under them (rule 17) ──
  if (settings.companyName) {
    doc.fontSize(20).fillColor(TEXT_DARK);
    drawSerifText(doc, SERIF, settings.companyName, LEFT, BAND_TOP + 8, { width: PAGE_W * 0.55 });
  }

  doc.fontSize(22).fillColor(BRAND).font(SERIF)
    .text(L.documentTitle, LEFT + PAGE_W * 0.6, BAND_TOP + 4, { width: PAGE_W * 0.4 - RIGHT_PAD, align: 'right', characterSpacing: 1.5 });
  doc.fontSize(10).fillColor(TEXT_LIGHT).font('Helvetica')
    .text(L.documentNumber(full.devisNumber), LEFT + PAGE_W * 0.6, BAND_TOP + 31, { width: PAGE_W * 0.4 - RIGHT_PAD, align: 'right' });
  doc.moveTo(LEFT, BAND_TOP + BAND_HEIGHT).lineTo(LEFT + PAGE_W, BAND_TOP + BAND_HEIGHT).strokeColor(BRAND).lineWidth(1.5).stroke();

  // ── Company & client block ───────────────────────────────────────────────
  const INFO_TOP = BAND_TOP + 74;
  // COL2 aligned with the start of the 3rd meta pill (Logement)
  const COL2 = LEFT + (PAGE_W * 2 / 3);

  // Logo à gauche de l'émetteur (si présent)
  const EMETTEUR_LEFT = HAS_LOGO ? LEFT + LOGO_W + 12 : LEFT;
  const EMETTEUR_WIDTH = HAS_LOGO ? PAGE_W * 0.55 - LOGO_W - 12 : PAGE_W * 0.55;

  if (HAS_LOGO) {
    const logoAbsPath = path.join(uploadsDir(), path.basename(settings.companyLogoPath));
    doc.image(logoAbsPath, LEFT, INFO_TOP, { height: LOGO_H, width: LOGO_W, fit: [LOGO_W, LOGO_H], align: 'left', valign: 'center' });
  }

  // Company info (right of logo, or at LEFT if no logo)
  doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica-Bold').text(L.issuer, EMETTEUR_LEFT, INFO_TOP);
  let cy = INFO_TOP + 14;
  doc.fontSize(10).fillColor(TEXT_DARK).font('Helvetica-Bold');
  if (settings.companyName) {
    doc.text(settings.companyName, EMETTEUR_LEFT, cy, { width: EMETTEUR_WIDTH }); cy += 14;
  }
  doc.font('Helvetica').fontSize(9).fillColor(TEXT_LIGHT);
  if (settings.companyAddress) {
    const addrLines = settings.companyAddress.split('\n');
    for (const line of addrLines) {
      doc.text(line, EMETTEUR_LEFT, cy, { width: EMETTEUR_WIDTH }); cy += 13;
    }
  }
  if (settings.companyPhone) {
    doc.text(`${L.phonePrefix}${settings.companyPhone}`, EMETTEUR_LEFT, cy, { width: EMETTEUR_WIDTH });
    cy += 13;
  }
  if (settings.companyEmail) {
    doc.text(`${L.emailPrefix}${settings.companyEmail}`, EMETTEUR_LEFT, cy, { width: EMETTEUR_WIDTH });
    cy += 13;
  }

  // Client info (right)
  doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica-Bold').text(L.client, COL2, INFO_TOP);
  let ccy = INFO_TOP + 14;
  doc.fontSize(10).fillColor(TEXT_DARK).font('Helvetica-Bold');
  const clientName = `${client.firstName || ''} ${client.lastName || ''}`.trim();
  doc.text(clientName, COL2, ccy); ccy += 14;
  doc.font('Helvetica').fontSize(9).fillColor(TEXT_LIGHT);
  const clientAddrParts = [
    [client.streetNumber, client.street].filter(Boolean).join(' '),
    [client.postalCode, client.city].filter(Boolean).join(' '),
  ].filter(Boolean);
  for (const part of clientAddrParts) {
    doc.text(part, COL2, ccy); ccy += 13;
  }
  for (const phone of phones) {
    if (phone) { doc.text(`${L.phonePrefix}${phone}`, COL2, ccy); ccy += 13; }
  }
  if (client.email) {
    doc.text(`${L.emailPrefix}${client.email}`, COL2, ccy); ccy += 13;
  }

  // ── Devis meta ────────────────────────────────────────────────────────────
  const META_TOP = Math.max(cy, ccy) + 18;

  // §3.1 + §3.2 — Date du devis + Valable jusqu'au.
  //
  // `createdAt` is normally populated by the model (§3.1 rule 1 binds it explicitly on INSERT).
  // The fallback to "today" below is a legacy guard for the handful of pre-fix rows persisted
  // with an empty value (devis #12102, #12097 etc. in the prod-copy DB) — without it those
  // legacy PDFs show an empty "Date du devis" pill.
  const todayIsoDate = localTodayIso();
  const createdAtIsoDate = full.createdAt
    ? String(full.createdAt).slice(0, 10)
    : todayIsoDate;

  // `validUntil` is normally persisted by the model (§3.2 rule 6) as
  // MIN(createdAt + quoteValidityDays, startDate - 2). The fallback below recomputes the
  // same formula from `createdAt` for legacy rows where `validUntil` is NULL — these are
  // the same rows the spec §3.2 rule 9 calls out as the forward-only safety net.
  const validUntilIso = (() => {
    if (full.validUntil) return String(full.validUntil);
    const days = Number(settings && settings.quoteValidityDays) || 30;
    let iso = addDaysToIsoDate(createdAtIsoDate, days) || '';
    const startDateIso = String(full.startDate || '');
    if (startDateIso && iso && iso > startDateIso) {
      iso = addDaysToIsoDate(startDateIso, -2) || iso;
    }
    return iso;
  })();

  // Meta pills
  const metaItems = [
    { label: L.date,       value: fmtDate(createdAtIsoDate) },
    // specs/ui-review-2026-10-19-operations.md rule 20 — the date alone: « (expiré) » is for the operator,
    // who is warned on the fiche, never for the guest.
    { label: L.validUntil, value: fmtDate(validUntilIso) },
    { label: L.property,   value: property ? property.name : `#${full.propertyId}` },
  ];

  const pillW = PAGE_W / metaItems.length - 6;
  metaItems.forEach((item, i) => {
    const px = LEFT + i * (pillW + 6);
    doc.rect(px, META_TOP, pillW, 40).fill(LIGHT_GRAY);
    doc.fontSize(8).fillColor(TEXT_LIGHT).font('Helvetica').text(item.label, px + 8, META_TOP + 6);
    doc.fontSize(10).fillColor(TEXT_DARK).font('Helvetica-Bold').text(item.value, px + 8, META_TOP + 18, { width: pillW - 16 });
  });

  // ── Séjour section ────────────────────────────────────────────────────────
  const SEJ_TOP = META_TOP + 52;
  doc.fontSize(12).fillColor(BRAND).font(SERIF).text(L.stayHeading, LEFT, SEJ_TOP);
  doc.moveTo(LEFT, SEJ_TOP + 17).lineTo(LEFT + PAGE_W, SEJ_TOP + 17).strokeColor(BRAND).lineWidth(1.5).stroke();

  const nights = diffDays(full.startDate, full.endDate);

  // Ligne 1 : arrivée, départ, durée
  const row1 = [
    [L.arrival,   `${fmtDate(full.startDate)} ${atSeparator} ${full.checkInTime || '15:00'}`],
    [L.departure, `${fmtDate(full.endDate)} ${atSeparator} ${full.checkOutTime || '10:00'}`],
    [L.duration,  L.durationValue(nights)],
  ];

  // Ligne 2 : composition voyageurs
  const row2 = [[L.adults, String(full.adults || 0)]];
  if (Number(full.teens || 0) > 0) row2.push([L.teens, String(full.teens)]);
  if (Number(full.children || 0) > 0) row2.push([L.children, String(full.children)]);
  if (Number(full.babies || 0) > 0) row2.push([L.babies, String(full.babies)]);

  const ROW_H = 38;

  // Chaque ligne répartit ses items sur toute la largeur
  function drawSejRow(items, sy) {
    const gap = 8;
    const w = (PAGE_W - gap * (items.length - 1)) / items.length;
    items.forEach(([label, value], i) => {
      const sx = LEFT + i * (w + gap);
      doc.fontSize(8).fillColor(TEXT_LIGHT).font('Helvetica').text(label, sx, sy);
      doc.fontSize(10).fillColor(TEXT_DARK).font('Helvetica-Bold').text(value, sx, sy + 11, { width: w });
    });
  }

  const sy1 = SEJ_TOP + 22;
  drawSejRow(row1, sy1);
  const sy2 = sy1 + ROW_H;
  drawSejRow(row2, sy2);
  const sy = sy2;

  // ── Pricing table ─────────────────────────────────────────────────────────
  // The rows are collected first and drawn after the page-1 summary block, whose total is the one
  // the table adds up to (specs/ui-review-2026-10-19-operations.md rule 19).
  const COL_DESC = LEFT;
  const COL_QTY = LEFT + PAGE_W * 0.5;
  const COL_HT = LEFT + PAGE_W * 0.6;
  const COL_VAT = LEFT + PAGE_W * 0.76;
  const COL_TOTAL = LEFT + PAGE_W * 0.86;

  let rowY = 0;
  let rowIdx = 0;
  let subtotalHt = 0;
  let subtotalTtcFromRows = 0;
  const pendingRows = [];
  // Every line offered to the guest, printed once in one row (rule 18).
  const offeredLines = [];

  // A row is exactly as tall as what it prints (specs/devis-pdf-row-layout.md §3): the designation is
  // measured, so a long option label simply wraps and the row grows with it.
  const DESC_W = PAGE_W * 0.48;

  // A struck-through "was" amount, right-aligned in its column, on the label's line.
  function drawStruckAmount(text, colX, colW, y) {
    doc.fontSize(7.5).fillColor(TEXT_LIGHT).font('Helvetica')
      .text(text, colX, y, { width: colW, align: 'right' });
    const w = doc.widthOfString(text);
    const x = colX + colW - w;
    doc.moveTo(x, y + 4).lineTo(x + w, y + 4).strokeColor(TEXT_LIGHT).lineWidth(0.6).stroke();
  }

  function drawRow(desc, qty, totalTtc, vatRate, italic, meta = {}) {
    subtotalHt += rowHt(totalTtc, vatRate);
    subtotalTtcFromRows += Number(totalTtc || 0);
    pendingRows.push([desc, qty, totalTtc, vatRate, italic, meta]);
  }

  function paintRow(desc, qty, totalTtc, vatRate, italic, meta = {}) {
    const originalTtc = Number(meta.originalTtc || 0);
    // The original is struck only when it's higher: a strike-through reads as a reduction, so a lower
    // « was » price above a higher billed one reads as a discount that is not there
    // (specs/review-2026-10-18-reservations.md rule 2).
    const showOriginal = showsStruckOriginal(originalTtc, totalTtc);
    const hasBadge = Boolean(meta.badgeText);
    const descText = String(desc == null ? '' : desc);
    const badgeText = hasBadge ? String(meta.badgeText) : '';

    // Measure everything before drawing anything, then let the geometry resolver place it.
    doc.fontSize(9).font(italic ? 'Helvetica-Oblique' : 'Helvetica');
    const descHeight = doc.heightOfString(descText, { width: DESC_W });
    doc.font('Helvetica');
    const moneyLineHeight = doc.heightOfString('0', { width: DESC_W });
    doc.fontSize(7.5).font('Helvetica-Bold');
    const badgeHeight = hasBadge ? doc.heightOfString(badgeText, { width: DESC_W }) : 0;
    const struckLineHeight = doc.heightOfString('0', { width: DESC_W });
    const { rowH, badgeY, lineY: lineOffsetY, amountY: amountOffsetY } = resolveRowGeometry({
      descHeight, badgeHeight, moneyLineHeight, struckLineHeight, showOriginal,
    });

    rowY = checkBreak(rowY, rowH);
    if (rowIdx % 2 === 0) doc.rect(LEFT, rowY, PAGE_W, rowH).fill(LIGHT_GRAY);
    const rate = Number(vatRate || 0);
    const ht = rowHt(totalTtc, rate);

    // The badge owns the line above the label; every other column aligns with the label's first line.
    if (hasBadge) {
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(OFFERED_GREEN)
        .text(badgeText, COL_DESC + 4, rowY + badgeY, { width: DESC_W });
    }
    const lineY = rowY + lineOffsetY;

    doc.fontSize(9).fillColor(TEXT_DARK);
    if (italic) doc.font('Helvetica-Oblique'); else doc.font('Helvetica');
    doc.text(descText, COL_DESC + 4, lineY, { width: DESC_W });
    doc.font('Helvetica').text(String(qty), COL_QTY, lineY, { width: PAGE_W * 0.1, align: 'center' });
    doc.text(`${rate.toFixed(2).replace('.', ',')}%`, COL_VAT, lineY, { width: PAGE_W * 0.1, align: 'center' });

    if (showOriginal) {
      const originalHt = rate > 0
        ? roundMoney(originalTtc / (1 + (rate / 100)))
        : roundMoney(originalTtc);
      drawStruckAmount(formatCurrency(originalHt), COL_HT, PAGE_W * 0.16 - RIGHT_PAD, lineY);
      drawStruckAmount(formatCurrency(originalTtc), COL_TOTAL, PAGE_W * 0.14 - RIGHT_PAD, lineY);
    }
    const amountY = rowY + amountOffsetY;
    doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica')
      .text(formatCurrency(ht), COL_HT, amountY, { width: PAGE_W * 0.16 - RIGHT_PAD, align: 'right' });
    doc.font('Helvetica-Bold')
      .text(formatCurrency(totalTtc), COL_TOTAL, amountY, { width: PAGE_W * 0.14 - RIGHT_PAD, align: 'right' });
    rowY += rowH;
    rowIdx++;
  }

  // Accommodation row(s).
  // A manual price (customPrice) overrides the engine/per-night accommodation price: render one
  // accommodation row at the manual amount (engine price struck through when it's a reduction) so the
  // HT/TTC subtotals reconcile with the grand total (finalPrice). Otherwise fall back to the per-night
  // breakdown or a flat row, applying any discount.
  const optionsTotalTtc = (full.options || []).reduce((s, o) => s + lineAmounts(o).billed, 0);
  const resourcesTotalTtc = (full.resources || []).reduce((s, r) => s + lineAmounts(r).billed, 0);
  const hasManualPrice = full.customPrice != null && full.customPrice !== '';
  // What the accommodation branches actually put on paper — the supplement fallback derives the
  // unexplained remainder from it.
  let accommodationTtcDrawn = 0;

  if (hasManualPrice) {
    // `totalPrice` is the engine accommodation price (no extras) — the same "Prix hébergement brut"
    // shown struck in the app summary. `finalPrice` is the adjusted accommodation + options + resources,
    // so the manual accommodation amount is finalPrice minus those extras.
    const engineAccommodationTtc = roundMoney(Number(full.totalPrice || 0));
    const manualAccommodationTtc = roundMoney(Number(full.finalPrice || 0) - optionsTotalTtc - resourcesTotalTtc);
    drawRow(L.accommodation(nights), nights, manualAccommodationTtc, vatAccommodation, false, {
      originalTtc: engineAccommodationTtc,
    });
    accommodationTtcDrawn += manualAccommodationTtc;
  } else if (full.nights && full.nights.length > 0) {
    // Group consecutive nights by season
    let groups = [];
    let cur = null;
    for (const n of full.nights) {
      if (cur && cur.seasonLabel === n.seasonLabel && cur.pricingMode === n.pricingMode) {
        cur.count++;
        cur.totalPrice += n.price;
        cur.lastDate = n.date;
      } else {
        if (cur) groups.push(cur);
        cur = { seasonLabel: n.seasonLabel, pricingMode: n.pricingMode, count: 1, unitPrice: n.price, totalPrice: n.price, firstDate: n.date, lastDate: n.date };
      }
    }
    if (cur) groups.push(cur);
    const accommodationFactor = Number(full.discountPercent || 0) > 0
      ? Math.max(0, 1 - (Number(full.discountPercent || 0) / 100))
      : 1;
    for (const g of groups) {
      const label = L.accommodationWithSeason(g.count, g.seasonLabel);
      const reducedTotal = roundMoney(Number(g.totalPrice || 0) * accommodationFactor);
      drawRow(label, g.count, reducedTotal, vatAccommodation, false, {
        originalTtc: Number(g.totalPrice || 0),
        badgeText: Number(full.discountPercent || 0) > 0 ? L.accommodationDiscount(Number(full.discountPercent || 0)) : '',
      });
      accommodationTtcDrawn += reducedTotal;
    }
  } else {
    // Flat accommodation row
    const accTotal = roundMoney((full.totalPrice || 0) - optionsTotalTtc - resourcesTotalTtc);
    const accommodationFactor = Number(full.discountPercent || 0) > 0
      ? Math.max(0, 1 - (Number(full.discountPercent || 0) / 100))
      : 1;
    const reducedAccTotal = roundMoney(Number(accTotal || 0) * accommodationFactor);
    drawRow(L.accommodation(nights), nights, reducedAccTotal, vatAccommodation, false, {
      originalTtc: Number(accTotal || 0),
      badgeText: Number(full.discountPercent || 0) > 0 ? L.accommodationDiscount(Number(full.discountPercent || 0)) : '',
    });
    accommodationTtcDrawn += reducedAccTotal;
  }

  // Extra-guest supplement (specs/tariff-events-and-extra-guest-tiers §6). Until now it lived in
  // the GRAND TOTAL only, so any devis with extra guests printed a sub-total that did not match its
  // own lines. Skipped under a manual price, whose accommodation row already absorbs it.
  if (!hasManualPrice) {
    const supplementRow = resolveExtraGuestPdfRow({
      quote,
      finalPriceTtc: Number(full.finalPrice || 0),
      accommodationTtc: accommodationTtcDrawn,
      optionsTtc: optionsTotalTtc,
      resourcesTtc: resourcesTotalTtc,
    });
    if (supplementRow && supplementRow.offered) {
      offeredLines.push({ name: L.extraGuestSupplement(supplementRow.count, null), real: supplementRow.originalTtc });
    } else if (supplementRow) {
      const detail = language === 'fr' ? supplementRow.tiersLabel : null;
      drawRow(
        L.extraGuestSupplement(supplementRow.count, detail),
        supplementRow.count || 1,
        supplementRow.totalTtc,
        vatAccommodation,
        false,
        {},
      );
    }
  }

  // Options
  for (const opt of full.options || []) {
    let optionLabelText = optionTitle(opt);
    if (opt.autoOptionType === 'early_check_in' || opt.autoOptionType === 'late_check_out') {
      const isEarly = opt.autoOptionType === 'early_check_in';
      const defaultHour = isEarly
        ? timeToDecimalHour(full.property?.checkInTime || '15:00', 15)
        : timeToDecimalHour(full.property?.checkOutTime || '10:00', 10);
      const requestedHour = isEarly
        ? timeToDecimalHour(full.checkInTime || full.property?.checkInTime || '15:00', defaultHour)
        : timeToDecimalHour(full.checkOutTime || full.property?.checkOutTime || '10:00', defaultHour);
      const extraHours = isEarly
        ? Math.max(0, defaultHour - requestedHour)
        : Math.max(0, requestedHour - defaultHour);
      const hoursLabel = formatHoursLabel(extraHours);
      if (hoursLabel) {
        optionLabelText = `${optionLabelText} (${L.extraHoursSuffix(hoursLabel)})`;
      }
    }
    const { offered, billed, real } = lineAmounts(opt);
    if (offered) {
      offeredLines.push({ name: optionLabelText, real });
      continue;
    }
    drawRow(optionLabelText, opt.billedUnits || opt.quantity || 1, billed, vatOptions, false, {
      originalTtc: billed,
    });
  }

  // Resources
  for (const rsc of full.resources || []) {
    const { offered, billed, real } = lineAmounts(rsc);
    if (offered) {
      offeredLines.push({ name: resourceName(rsc), real });
      continue;
    }
    drawRow(resourceName(rsc), rsc.quantity || 1, billed, vatResources, false, {
      originalTtc: billed,
    });
  }

  // Rule 18 — one row « Offert avec le séjour » naming every offered line, billed 0, valued once.
  const offeredGroup = groupOffered(offeredLines);
  if (offeredGroup) {
    drawRow(offeredGroup.names, '', 0, vatOptions, false, {
      badgeText: `${L.offeredGroup} · ${L.offeredValue(formatCurrency(offeredGroup.value))}`,
    });
  }

  // specs/devis-pdf-total-parity.md §3.2 — the tax and the grand total are resolved against the stay
  // the table prints, so the totals can never contradict the lines. Resolved BEFORE drawing, so the
  // page-1 summary and the totals block print the same figure.
  const subtotalTtc = roundMoney(subtotalTtcFromRows);
  const { liveTaxTotal, grandTotalTtc, quoteReconciles } = resolveLiveTaxTotals(full, quote, subtotalTtc);

  // ── Page-1 summary: the total and when it is paid (rule 19) ───────────────
  const SUMMARY_TOP = sy + ROW_H + 6;
  const schedule = summarySchedule(full, L);
  const SUMMARY_H = Math.max(56, 16 + schedule.length * 16 + 10);
  doc.roundedRect(LEFT, SUMMARY_TOP, PAGE_W, SUMMARY_H, 6).fill(LIGHT_GRAY);
  doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica').text(L.summaryTotal, LEFT + 14, SUMMARY_TOP + 10, { width: PAGE_W * 0.4 });
  doc.fontSize(18).fillColor(TEXT_DARK).font('Helvetica-Bold')
    .text(formatCurrency(grandTotalTtc), LEFT + 14, SUMMARY_TOP + 24, { width: PAGE_W * 0.4, lineBreak: false });
  const SCHED_X = LEFT + PAGE_W * 0.44;
  const SCHED_W = PAGE_W * 0.56 - 14;
  schedule.forEach((line, i) => {
    const ly = SUMMARY_TOP + 12 + i * 16;
    doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica').text(line.label, SCHED_X, ly, { width: SCHED_W * 0.34, lineBreak: false });
    doc.font('Helvetica-Bold').fillColor(TEXT_DARK)
      .text(formatCurrency(line.amount), SCHED_X + SCHED_W * 0.34, ly, { width: SCHED_W * 0.26, align: 'right', lineBreak: false });
    if (line.dueDate) {
      doc.font('Helvetica').fillColor(TEXT_LIGHT)
        .text(L.summaryBefore(fmtDate(line.dueDate)), SCHED_X + SCHED_W * 0.64, ly, { width: SCHED_W * 0.36, align: 'right', lineBreak: false });
    }
  });
  if (typeof full.__trace === 'function') {
    full.__trace({ event: 'summary', page: doc.bufferedPageRange().count, total: grandTotalTtc });
  }

  const TABLE_TOP = SUMMARY_TOP + SUMMARY_H + 14;
  doc.fontSize(12).fillColor(BRAND).font(SERIF).text(L.pricingHeading, LEFT, TABLE_TOP);
  doc.moveTo(LEFT, TABLE_TOP + 17).lineTo(LEFT + PAGE_W, TABLE_TOP + 17).strokeColor(BRAND).lineWidth(1.5).stroke();

  // Table header — ink on paper under the fir rule.
  const TH = TABLE_TOP + 22;
  doc.rect(LEFT, TH, PAGE_W, 18).fill(LIGHT_GRAY);
  doc.moveTo(LEFT, TH + 18).lineTo(LEFT + PAGE_W, TH + 18).strokeColor(MID_GRAY).lineWidth(0.8).stroke();
  doc.fontSize(8.5).fillColor(TEXT_DARK).font('Helvetica-Bold');
  doc.text(L.colDesignation, COL_DESC + 4, TH + 5, { width: PAGE_W * 0.48 });
  doc.text(L.colQuantity,    COL_QTY,      TH + 5, { width: PAGE_W * 0.1, align: 'center' });
  doc.text(L.colUnitPriceHt, COL_HT,       TH + 5, { width: PAGE_W * 0.16 - RIGHT_PAD, align: 'right' });
  doc.text(L.colVatRate,     COL_VAT,      TH + 5, { width: PAGE_W * 0.1, align: 'center' });
  doc.text(L.colTotalTtc,    COL_TOTAL,    TH + 5, { width: PAGE_W * 0.14 - RIGHT_PAD, align: 'right' });
  rowY = TH + 18;
  for (const args of pendingRows) paintRow(...args);

  // Table bottom border
  doc.moveTo(LEFT, rowY).lineTo(LEFT + PAGE_W, rowY).strokeColor(MID_GRAY).lineWidth(0.5).stroke();

  // ── Totals ────────────────────────────────────────────────────────────────
  let totY = checkBreak(rowY + 10, 170);
  const TOTAL_LW = 200;
  const TOTAL_RX = LEFT + PAGE_W - TOTAL_LW;
  const LEFT_COL_W = Math.max(220, TOTAL_RX - LEFT - 20);
  let bankBottomY = totY;
  const BANK_BLOCK_Y_OFFSET = 6;

  if (settings.companyIban || settings.companyBic || settings.companyBankName) {
    const bankTop = totY + BANK_BLOCK_Y_OFFSET;
    let bankY = bankTop;
    doc.fontSize(10.5).fillColor(BRAND).font(SERIF).text(L.bankHeading, LEFT, bankY, { width: LEFT_COL_W, align: 'left' });
    bankY += 17;
    doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica');
    if (settings.companyBankName) {
      doc.text(`${L.bankAccount}${settings.companyBankName}`, LEFT, bankY, { width: LEFT_COL_W, align: 'left' });
      bankY += 13;
    }
    if (settings.companyBic) {
      doc.text(`${L.bankBic}${settings.companyBic}`, LEFT, bankY, { width: LEFT_COL_W, align: 'left' });
      bankY += 13;
    }
    if (settings.companyIban) {
      doc.text(`${L.bankIban}${settings.companyIban}`, LEFT, bankY, { width: LEFT_COL_W, align: 'left' });
      bankY += 13;
    }

    // Discreet frame around bank details block.
    doc
      .roundedRect(LEFT - 4, bankTop - 4, LEFT_COL_W - 14, (bankY - bankTop) + 8, 3)
      .lineWidth(0.6)
      .strokeColor(MID_GRAY)
      .stroke();

    bankBottomY = bankY + 2;
  }

  function drawTotalLine(label, amount, bold) {
    doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica').text(label, TOTAL_RX, totY, { width: 120 });
    if (bold) doc.font('Helvetica-Bold').fillColor(TEXT_DARK);
    else doc.font('Helvetica').fillColor(TEXT_DARK);
    doc.text(formatCurrency(amount), TOTAL_RX + 120, totY, { width: 80 - RIGHT_PAD, align: 'right' });
    totY += 16;
  }

  drawTotalLine(L.subtotalHt, subtotalHt, false);
  drawTotalLine(L.subtotalTtc, subtotalTtc, false);
  if (liveTaxTotal > 0) {
    drawTotalLine(L.touristTax, liveTaxTotal, false);
    // Rule 8 — the detail follows the amount it explains: the engine breakdown when the quote is what
    // we printed, otherwise a breakdown derived from the row so it multiplies out to that amount.
    const engineBreakdown = quoteReconciles && quote && Number(quote.touristTaxTotal || 0) > 0;
    const taxablePersons = engineBreakdown
      ? Number(quote.touristTaxAdultsCount || 0)
      : Number(full.adults || 0);
    const taxNights = engineBreakdown
      ? Number(quote.touristTaxNights || 0)
      : Math.max(0, diffDays(full.startDate, full.endDate));
    if (taxablePersons > 0 && taxNights > 0) {
      // Engine-authoritative per-person-per-night unit; the engine resolves percentage vs
      // fixed-amount + department tax + capping into a single coherent number.
      const taxUnitAmount = engineBreakdown
        ? Number(quote.touristTaxUnitAmount || 0)
        : roundMoney(liveTaxTotal / (taxablePersons * taxNights));
      const taxDetail = L.touristTaxBreakdown(taxablePersons, taxNights, formatCurrency(taxUnitAmount));
      doc.fontSize(8).fillColor(TEXT_LIGHT).font('Helvetica-Oblique')
        .text(taxDetail, TOTAL_RX, totY - 4, { width: TOTAL_LW - RIGHT_PAD, align: 'right' });
    }
    totY += 10;
  }

  // Total line
  doc.rect(TOTAL_RX - 10, totY - 2, TOTAL_LW + 10, 24).fill(BRAND);
  doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold')
    .text(L.grandTotal, TOTAL_RX - 4, totY + 4, { width: 120 });
  doc.text(formatCurrency(grandTotalTtc), TOTAL_RX + 120, totY + 4, { width: 80 - RIGHT_PAD, align: 'right' });
  totY += 30;
  totY = Math.max(totY, bankBottomY);

  // ── Payment schedule ──────────────────────────────────────────────────────
  totY = checkBreak(totY, 60);
  const PAY_TOP = totY + 14;
  doc.fontSize(12).fillColor(BRAND).font(SERIF).text(L.paymentHeading, LEFT, PAY_TOP);
  doc.moveTo(LEFT, PAY_TOP + 17).lineTo(LEFT + PAGE_W, PAY_TOP + 17).strokeColor(BRAND).lineWidth(1.5).stroke();

  let py = PAY_TOP + 24;
  const payTextColor = TEXT_DARK;
  const depositAmt = Number(full.depositAmount || 0);
  const balanceAmt = Number(full.balanceAmount || 0);
  const { securesDates, isFullPayment } = __resolvePaymentBlock({
    platform: full.platform, depositAmount: depositAmt, balanceAmount: balanceAmt,
  });

  // One geometry for both schedule rows, plus the mention that explains them. Two rules bought here:
  //   • the amount column opens after the label instead of at a fixed offset, so a long label
  //     (« Paiement intégral : », « Security deposit: ») can't run into the figure it introduces;
  //   • a row and its mention are measured and reserved TOGETHER, so a page break can never leave the
  //     sentence stranded at the top of the next page, away from the amount it qualifies.
  const drawScheduleRow = ({ label, amount, dueDate, fill, boxH, step, note = null, amountSuffix = '', labelColor = TEXT_LIGHT }) => {
    let noteH = 0;
    if (note) {
      doc.fontSize(8).font('Helvetica-Oblique');
      noteH = doc.heightOfString(note, { width: PAGE_W - 16 }) + 6;
    }
    py = checkBreak(py, step + noteH);

    doc.rect(LEFT, py, PAGE_W, boxH).fill(fill);
    doc.fontSize(9).font('Helvetica').fillColor(labelColor).text(label, LEFT + 8, py + 7);
    const amountX = LEFT + 8 + Math.max(62, doc.widthOfString(label) + 8);
    const amountText = `${formatCurrency(amount)}${amountSuffix}`;
    doc.font('Helvetica-Bold').fillColor(payTextColor).text(amountText, amountX, py + 7);
    if (dueDate) {
      const dateX = Math.max(LEFT + 170, amountX + doc.widthOfString(amountText) + 12);
      doc.font('Helvetica').fillColor(TEXT_LIGHT).text(`${L.payBefore}${fmtDate(dueDate)}`, dateX, py + 7);
    }
    py += step;

    if (note) {
      doc.fontSize(8).font('Helvetica-Oblique').fillColor(TEXT_LIGHT)
        .text(note, LEFT + 8, py, { width: PAGE_W - 16 });
      py += noteH;
    }
  };

  // Acompte (même logique que le résumé de réservation : montant + échéance)
  if (depositAmt > 0) {
    drawScheduleRow({
      label: L.depositLabel, amount: depositAmt, dueDate: full.depositDueDate,
      fill: PDF_PALETTE.honey, boxH: 28, step: 34,
      note: securesDates ? L.depositSecuresDates : null,
    });
  }

  // Solde — or, on a direct quote with no acompte, the single full payment (rule 8).
  if (balanceAmt > 0) {
    drawScheduleRow({
      label: isFullPayment ? L.fullPaymentLabel : L.balanceLabel,
      amount: balanceAmt,
      dueDate: full.balanceDueDate,
      fill: isFullPayment ? PDF_PALETTE.honey : LIGHT_GRAY,
      boxH: isFullPayment ? 28 : 24,
      step: isFullPayment ? 34 : 30,
      note: isFullPayment ? L.fullPaymentSecuresDates : null,
    });
  }

  // Caution — same column rule as the rows above: « Security deposit: » is longer than « Caution : »
  // and used to be overprinted by its own amount on the English quote.
  if (Number(full.cautionAmount || 0) > 0) {
    drawScheduleRow({
      label: L.cautionLabel, amount: full.cautionAmount, dueDate: null,
      fill: PDF_PALETTE.offeredSoft, boxH: 24, step: 30,
      amountSuffix: L.cautionOnArrival, labelColor: OFFERED_GREEN,
    });
  }

  // ── Custom footer text ────────────────────────────────────────────────────
  // Per-language: each language uses its own operator-customised footer when present, else a
  // static default in the right language (no cross-fall back: a French footer inside an EN PDF
  // would read as broken). Delegates to `__resolveFooterText` so the test surface stays small.
  const footerText = __resolveFooterText(settings, language, labels('en').defaultFooter, labels('fr').defaultFooter);

  if (footerText.trim()) {
    const footerH = doc.heightOfString(footerText, { width: PAGE_W }) + 30;
    py = checkBreak(py + 14, footerH);
    doc.rect(LEFT, py, PAGE_W, 1).fill(MID_GRAY);
    py += 8;
    doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica-Oblique')
      .text(footerText, LEFT, py, { width: PAGE_W, align: 'justify' });
    py += doc.heightOfString(footerText, { width: PAGE_W }) + 6;
  }

  // ── Per-page footer (company name + SIRET/TVA + page n/N) ─────────────────
  const legalParts = [];
  if (settings.companySiret) legalParts.push(`${L.siret}${settings.companySiret}`);
  if (settings.companyTva) legalParts.push(`${L.vatNumber}${settings.companyTva}`);
  const legalCenter = legalParts.join('   •   ');

  const range = doc.bufferedPageRange();
  const totalPages = range.count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(range.start + i);
    const fY = PAGE_H - MARGIN_BOTTOM - FOOTER_H;
    doc.rect(LEFT, fY, PAGE_W, 1).fill(MID_GRAY);
    const ftY = fY + 6;
    // Left: company name
    if (settings.companyName) {
      doc.fontSize(7.5).fillColor(TEXT_LIGHT).font('Helvetica-Bold')
        .text(settings.companyName, LEFT, ftY, { width: PAGE_W * 0.25, ellipsis: true });
    }
    // Center: SIRET / TVA — wide column + no wrap so both stay on a single line.
    if (legalCenter) {
      doc.fontSize(7.5).fillColor(TEXT_LIGHT).font('Helvetica')
        .text(legalCenter, LEFT + PAGE_W * 0.25, ftY, { width: PAGE_W * 0.5, align: 'center', lineBreak: false });
    }
    // Right: page X / N
    doc.fontSize(7.5).fillColor(TEXT_LIGHT).font('Helvetica')
      .text(L.pageNumber(i + 1, totalPages), LEFT + PAGE_W * 0.75, ftY, { width: PAGE_W * 0.25, align: 'right' });
  }

  doc.flushPages();
  doc.end();
  });
}

// Pure resolvers exposed for unit testing the bilingual fallback logic without rendering a
// full PDF (PDFKit encodes text as glyph indexes, so the rendered bytes can't be grep'd for
// language-specific strings). The renderer above uses the same shape inline so behaviour
// stays in sync.
function __resolveOptionTitle(opt, language) {
  const lang = String(language || 'fr').toLowerCase();
  if (lang === 'en' && opt && String(opt.titleEn || '').trim()) return String(opt.titleEn).trim();
  return opt && opt.title ? opt.title : `Option #${opt?.optionId}`;
}

function __resolveResourceName(rsc, language) {
  const lang = String(language || 'fr').toLowerCase();
  if (lang === 'en' && rsc && String(rsc.nameEn || '').trim()) return String(rsc.nameEn).trim();
  return rsc && rsc.name ? rsc.name : `Resource #${rsc?.resourceId}`;
}

// specs/deposit-blocks-the-dates.md rules 1, 3 and 8 — who the payment block speaks to and what it
// calls the money:
//   • `securesDates` — only a DIRECT channel promises to hold the dates against a payment we collect;
//     a platform booking is settled by the platform, so its block stays mention-free.
//   • `isFullPayment` — a direct quote with no acompte owes ONE payment; calling 100 % of a stay a
//     « solde » would name something that never existed.
function __resolvePaymentBlock({ platform, depositAmount, balanceAmount } = {}) {
  const securesDates = isDirectChannel(platform);
  return {
    securesDates,
    isFullPayment: securesDates && Number(depositAmount || 0) <= 0 && Number(balanceAmount || 0) > 0,
  };
}

function __resolveFooterText(settings, language, defaultEn, defaultFr) {
  const lang = String(language || 'fr').toLowerCase();
  const custom = lang === 'en' ? settings?.quoteFooterTextEn : settings?.quoteFooterText;
  if (custom && String(custom).trim()) return String(custom);
  return lang === 'en' ? defaultEn : defaultFr;
}

// specs/ui-review-2026-10-19-operations.md rule 18 — the offered lines, as the one row that names them.
function groupOffered(lines) {
  const list = (lines || []).filter((l) => l && String(l.name || '').trim());
  if (list.length === 0) return null;
  return {
    names: list.map((l) => String(l.name).trim()).join(', '),
    count: list.length,
    value: roundMoney(list.reduce((sum, l) => sum + Number(l.real || 0), 0)),
  };
}

// specs/ui-review-2026-10-19-operations.md rule 19 — the schedule of the page-1 summary: the acompte,
// then the solde (or the single payment of a direct quote with no acompte, named as such).
function summarySchedule(full, L) {
  const deposit = Number(full?.depositAmount || 0);
  const balance = Number(full?.balanceAmount || 0);
  const { isFullPayment } = __resolvePaymentBlock({ platform: full?.platform, depositAmount: deposit, balanceAmount: balance });
  const lines = [];
  if (deposit > 0) lines.push({ label: L.summaryDeposit, amount: deposit, dueDate: full.depositDueDate || null });
  if (balance > 0) {
    lines.push({ label: isFullPayment ? L.summaryFull : L.summaryBalance, amount: balance, dueDate: full.balanceDueDate || null });
  }
  return lines;
}

// HT of one table row: its TTC net of the line's VAT, rounded like the column prints it.
function rowHt(totalTtc, vatRate) {
  const rate = Number(vatRate || 0);
  return rate > 0 ? roundMoney(Number(totalTtc || 0) / (1 + (rate / 100))) : roundMoney(Number(totalTtc || 0));
}

module.exports = {
  generateDevisPdf,
  __test: {
    showsStruckOriginal,
    groupOffered,
    summarySchedule,
    serifRuns,
    PDF_PALETTE,
    resolveLiveTaxTotals,
    lineAmounts,
    resolveRowGeometry,
    resolveOptionTitle: __resolveOptionTitle,
    resolveResourceName: __resolveResourceName,
    resolveFooterText: __resolveFooterText,
    resolvePaymentBlock: __resolvePaymentBlock,
  },
};
