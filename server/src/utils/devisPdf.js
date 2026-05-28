/**
 * Devis PDF renderer — pure presentation. Takes an enriched devis (`full`, incl. property/client/options/
 * resources/nights) + app `settings` and returns the PDF as a Buffer. No DB access. Extracted verbatim
 * from the former routes/devis.js GET /:id/pdf so the output is byte-identical.
 */

const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const {
  roundMoney, formatDateFR, formatCurrency, isLineOffered,
  timeToDecimalHour, formatHoursLabel, diffDays, addDaysToIsoDate, formatDate,
} = require("./devisHelpers");

function generateDevisPdf(full, settings) {
  return new Promise((resolve, reject) => {
  const property = full.property;
  const client = full.client;
  const vatAccommodation = Number(property?.vatPercentageAccommodation ?? 20);
  const vatOptions = Number(property?.vatPercentageOptions ?? 20);
  const vatResources = Number(property?.vatPercentageResources ?? 20);

  // Client phone (single column since the Clients bloc).
  const phones = client.phone ? [String(client.phone).trim()] : [];

  const BRAND = '#1a3a5c';
  const LIGHT_GRAY = '#f5f5f5';
  const MID_GRAY = '#cccccc';
  const TEXT_DARK = '#222222';
  const TEXT_LIGHT = '#555555';

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 34, bottom: 34, left: 45, right: 45 },
    bufferPages: true,
    info: {
      Title: `Devis ${full.devisNumber}`,
      Author: settings.companyName || 'GuestFlow',
    },
  });

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
  const HAS_LOGO = settings.companyLogoPath && fs.existsSync(path.join(__dirname, '..', '..', 'uploads', path.basename(settings.companyLogoPath)));
  const BAND_TOP = 40;
  const BAND_HEIGHT = 52;

  // ── Header band ──────────────────────────────────────────────────────────
  doc.rect(LEFT, BAND_TOP, PAGE_W, BAND_HEIGHT).fill(BRAND);

  if (settings.companyName) {
    doc.fontSize(20).fillColor('#ffffff').font('Helvetica-Bold')
      .text(settings.companyName, LEFT + 12, BAND_TOP + 10, { width: PAGE_W * 0.55 });
  }

  // Devis title top-right
  doc.fontSize(18).fillColor('#ffffff').font('Helvetica-Bold')
    .text('DEVIS', LEFT + PAGE_W * 0.6, BAND_TOP + 10, { width: PAGE_W * 0.4 - RIGHT_PAD, align: 'right' });
  doc.fontSize(10).fillColor('#cce0ff').font('Helvetica')
    .text(`N° ${full.devisNumber}`, LEFT + PAGE_W * 0.6, BAND_TOP + 31, { width: PAGE_W * 0.4 - RIGHT_PAD, align: 'right' });

  // ── Company & client block ───────────────────────────────────────────────
  const INFO_TOP = BAND_TOP + 74;
  // COL2 aligned with the start of the 3rd meta pill (Logement)
  const COL2 = LEFT + (PAGE_W * 2 / 3);

  // Logo à gauche de l'émetteur (si présent)
  const EMETTEUR_LEFT = HAS_LOGO ? LEFT + LOGO_W + 12 : LEFT;
  const EMETTEUR_WIDTH = HAS_LOGO ? PAGE_W * 0.55 - LOGO_W - 12 : PAGE_W * 0.55;

  if (HAS_LOGO) {
    const logoAbsPath = path.join(__dirname, '..', '..', 'uploads', path.basename(settings.companyLogoPath));
    doc.image(logoAbsPath, LEFT, INFO_TOP, { height: LOGO_H, width: LOGO_W, fit: [LOGO_W, LOGO_H], align: 'left', valign: 'center' });
  }

  // Company info (right of logo, or at LEFT if no logo)
  doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica-Bold').text('ÉMETTEUR', EMETTEUR_LEFT, INFO_TOP);
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
    doc.text(`Tél : ${settings.companyPhone}`, EMETTEUR_LEFT, cy, { width: EMETTEUR_WIDTH });
    cy += 13;
  }
  if (settings.companyEmail) {
    doc.text(`Email : ${settings.companyEmail}`, EMETTEUR_LEFT, cy, { width: EMETTEUR_WIDTH });
    cy += 13;
  }

  // Client info (right)
  doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica-Bold').text('CLIENT', COL2, INFO_TOP);
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
    if (phone) { doc.text(`Tél : ${phone}`, COL2, ccy); ccy += 13; }
  }
  if (client.email) {
    doc.text(`Email : ${client.email}`, COL2, ccy); ccy += 13;
  }

  // ── Devis meta ────────────────────────────────────────────────────────────
  const META_TOP = Math.max(cy, ccy) + 18;

  // Meta pills
  const metaItems = [
    { label: 'Date du devis', value: formatDateFR(full.createdAt ? full.createdAt.slice(0, 10) : '') },
    { label: 'Valable jusqu\'au', value: (() => {
      let validUntilIso = '';
      if (full.validUntil) {
        validUntilIso = String(full.validUntil);
      } else {
        const days = Number(settings.quoteValidityDays) || 30;
        const d = new Date();
        d.setDate(d.getDate() + days);
        validUntilIso = d.toISOString().slice(0, 10);
      }

      const startDateIso = String(full.startDate || '');
      if (startDateIso && validUntilIso && validUntilIso > startDateIso) {
        validUntilIso = addDaysToIsoDate(startDateIso, -2) || validUntilIso;
      }

      return formatDateFR(validUntilIso);
    })() },
    { label: 'Logement', value: property ? property.name : `#${full.propertyId}` },
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
  doc.fontSize(11).fillColor(BRAND).font('Helvetica-Bold').text('DÉTAIL DU SÉJOUR', LEFT, SEJ_TOP);
  doc.moveTo(LEFT, SEJ_TOP + 15).lineTo(LEFT + PAGE_W, SEJ_TOP + 15).strokeColor(BRAND).lineWidth(1.5).stroke();

  const nights = diffDays(full.startDate, full.endDate);

  // Ligne 1 : arrivée, départ, durée
  const row1 = [
    ['Arrivée', `${formatDateFR(full.startDate)} à ${full.checkInTime || '15:00'}`],
    ['Départ', `${formatDateFR(full.endDate)} à ${full.checkOutTime || '10:00'}`],
    ['Durée', `${nights} nuit${nights > 1 ? 's' : ''}`],
  ];

  // Ligne 2 : composition voyageurs
  const row2 = [['Adultes', String(full.adults || 0)]];
  if (Number(full.teens || 0) > 0) row2.push(['Adolescents', String(full.teens)]);
  if (Number(full.children || 0) > 0) row2.push(['Enfants', String(full.children)]);
  if (Number(full.babies || 0) > 0) row2.push(['Bébés', String(full.babies)]);

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
  const TABLE_TOP = sy + ROW_H + 6;
  doc.fontSize(11).fillColor(BRAND).font('Helvetica-Bold').text('DÉTAIL TARIFAIRE', LEFT, TABLE_TOP);
  doc.moveTo(LEFT, TABLE_TOP + 15).lineTo(LEFT + PAGE_W, TABLE_TOP + 15).strokeColor(BRAND).lineWidth(1.5).stroke();

  // Table header
  const TH = TABLE_TOP + 20;
  const COL_DESC = LEFT;
  const COL_QTY = LEFT + PAGE_W * 0.5;
  const COL_HT = LEFT + PAGE_W * 0.6;
  const COL_VAT = LEFT + PAGE_W * 0.76;
  const COL_TOTAL = LEFT + PAGE_W * 0.86;

  doc.rect(LEFT, TH, PAGE_W, 18).fill(BRAND);
  doc.fontSize(8.5).fillColor('#ffffff').font('Helvetica-Bold');
  doc.text('Désignation', COL_DESC + 4, TH + 5, { width: PAGE_W * 0.48 });
  doc.text('Qté', COL_QTY, TH + 5, { width: PAGE_W * 0.1, align: 'center' });
  doc.text('Prix HT', COL_HT, TH + 5, { width: PAGE_W * 0.16 - RIGHT_PAD, align: 'right' });
  doc.text('TVA %', COL_VAT, TH + 5, { width: PAGE_W * 0.1, align: 'center' });
  doc.text('Total TTC', COL_TOTAL, TH + 5, { width: PAGE_W * 0.14 - RIGHT_PAD, align: 'right' });

  let rowY = TH + 18;
  let rowIdx = 0;
  let subtotalHt = 0;
  let subtotalTtcFromRows = 0;

  function drawRow(desc, qty, totalTtc, vatRate, italic, meta = {}) {
    const originalTtc = Number(meta.originalTtc || 0);
    // By default the original is struck only when it's higher (a reduction). `forceOriginal` strikes it
    // in either direction (used for a manual accommodation price, which can be lower or higher).
    const showOriginal = meta.forceOriginal
      ? originalTtc > 0 && Math.abs(originalTtc - Number(totalTtc || 0)) > 0.009
      : originalTtc > Number(totalTtc || 0) + 0.009;
    const hasBadge = Boolean(meta.badgeText);
    const rowH = showOriginal || hasBadge ? 28 : 20;
    rowY = checkBreak(rowY, rowH);
    if (rowIdx % 2 === 0) doc.rect(LEFT, rowY, PAGE_W, rowH).fill(LIGHT_GRAY);
    const rate = Number(vatRate || 0);
    const ht = rate > 0 ? roundMoney(Number(totalTtc || 0) / (1 + (rate / 100))) : roundMoney(Number(totalTtc || 0));
    subtotalHt += ht;
    subtotalTtcFromRows += Number(totalTtc || 0);

    doc.fontSize(9).fillColor(TEXT_DARK);
    if (italic) doc.font('Helvetica-Oblique'); else doc.font('Helvetica');
    const descY = showOriginal ? rowY + 10 : rowY + 6;
    doc.text(desc, COL_DESC + 4, descY, { width: PAGE_W * 0.48 });
    if (hasBadge) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#2e7d32')
        .text(meta.badgeText, COL_DESC + 4, rowY + 3, { width: PAGE_W * 0.48 });
    }
    doc.font('Helvetica').text(String(qty), COL_QTY, rowY + 6, { width: PAGE_W * 0.1, align: 'center' });
    if (showOriginal) {
      const originalHt = rate > 0
        ? roundMoney(originalTtc / (1 + (rate / 100)))
        : roundMoney(originalTtc);
      const originalHtText = formatCurrency(originalHt);
      doc.fontSize(7.5).fillColor('#8a8a8a').font('Helvetica')
        .text(originalHtText, COL_HT, rowY + 3, { width: PAGE_W * 0.16 - RIGHT_PAD, align: 'right' });
      const oldHtWidth = doc.widthOfString(originalHtText);
      const oldHtX = COL_HT + (PAGE_W * 0.16 - RIGHT_PAD) - oldHtWidth;
      const oldHtY = rowY + 7;
      doc.moveTo(oldHtX, oldHtY).lineTo(oldHtX + oldHtWidth, oldHtY).strokeColor('#8a8a8a').lineWidth(0.6).stroke();
      doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica')
        .text(formatCurrency(ht), COL_HT, rowY + 14, { width: PAGE_W * 0.16 - RIGHT_PAD, align: 'right' });
    } else {
      doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica')
        .text(formatCurrency(ht), COL_HT, rowY + 6, { width: PAGE_W * 0.16 - RIGHT_PAD, align: 'right' });
    }
    doc.text(`${rate.toFixed(2).replace('.', ',')}%`, COL_VAT, rowY + 6, { width: PAGE_W * 0.1, align: 'center' });
    if (showOriginal) {
      const originalTtcText = formatCurrency(originalTtc);
      doc.fontSize(7.5).fillColor('#8a8a8a').font('Helvetica')
        .text(originalTtcText, COL_TOTAL, rowY + 3, { width: PAGE_W * 0.14 - RIGHT_PAD, align: 'right' });
      const oldTtcWidth = doc.widthOfString(originalTtcText);
      const oldTtcX = COL_TOTAL + (PAGE_W * 0.14 - RIGHT_PAD) - oldTtcWidth;
      const oldTtcY = rowY + 7;
      doc.moveTo(oldTtcX, oldTtcY).lineTo(oldTtcX + oldTtcWidth, oldTtcY).strokeColor('#8a8a8a').lineWidth(0.6).stroke();
      doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica-Bold')
        .text(formatCurrency(totalTtc), COL_TOTAL, rowY + 14, { width: PAGE_W * 0.14 - RIGHT_PAD, align: 'right' });
    } else {
      doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica-Bold')
        .text(formatCurrency(totalTtc), COL_TOTAL, rowY + 6, { width: PAGE_W * 0.14 - RIGHT_PAD, align: 'right' });
    }
    rowY += rowH;
    rowIdx++;
  }

  // Accommodation row(s).
  // A manual price (customPrice) overrides the engine/per-night accommodation price: render one
  // accommodation row at the manual amount (engine price struck through when it's a reduction) so the
  // HT/TTC subtotals reconcile with the grand total (finalPrice). Otherwise fall back to the per-night
  // breakdown or a flat row, applying any discount.
  const optionsTotalTtc = (full.options || []).reduce((s, o) => s + Number(o.totalPrice || 0), 0);
  const resourcesTotalTtc = (full.resources || []).reduce((s, r) => s + Number(r.totalPrice || 0), 0);
  const hasManualPrice = full.customPrice != null && full.customPrice !== '';

  if (hasManualPrice) {
    // `totalPrice` is the engine accommodation price (no extras) — the same "Prix hébergement brut"
    // shown struck in the app summary. `finalPrice` is the adjusted accommodation + options + resources,
    // so the manual accommodation amount is finalPrice minus those extras.
    const engineAccommodationTtc = roundMoney(Number(full.totalPrice || 0));
    const manualAccommodationTtc = roundMoney(Number(full.finalPrice || 0) - optionsTotalTtc - resourcesTotalTtc);
    drawRow(`Hébergement — ${nights} nuit${nights > 1 ? 's' : ''}`, nights, manualAccommodationTtc, vatAccommodation, false, {
      originalTtc: engineAccommodationTtc,
      forceOriginal: true,
    });
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
      const label = g.count === 1
        ? `Hébergement — 1 nuit (${g.seasonLabel})`
        : `Hébergement — ${g.count} nuits (${g.seasonLabel})`;
      const reducedTotal = roundMoney(Number(g.totalPrice || 0) * accommodationFactor);
      drawRow(label, g.count, reducedTotal, vatAccommodation, false, {
        originalTtc: Number(g.totalPrice || 0),
        badgeText: Number(full.discountPercent || 0) > 0 ? `RÉDUCTION LOGEMENT ${Number(full.discountPercent || 0)}%` : '',
      });
    }
  } else {
    // Flat accommodation row
    const accTotal = roundMoney((full.totalPrice || 0) - (full.options || []).reduce((s, o) => s + o.totalPrice, 0) - (full.resources || []).reduce((s, r) => s + r.totalPrice, 0));
    const accommodationFactor = Number(full.discountPercent || 0) > 0
      ? Math.max(0, 1 - (Number(full.discountPercent || 0) / 100))
      : 1;
    const reducedAccTotal = roundMoney(Number(accTotal || 0) * accommodationFactor);
    drawRow(`Hébergement — ${nights} nuit${nights > 1 ? 's' : ''}`, nights, reducedAccTotal, vatAccommodation, false, {
      originalTtc: Number(accTotal || 0),
      badgeText: Number(full.discountPercent || 0) > 0 ? `RÉDUCTION LOGEMENT ${Number(full.discountPercent || 0)}%` : '',
    });
  }

  // Options
  for (const opt of full.options || []) {
    let optionLabel = opt.title || `Option #${opt.optionId}`;
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
        optionLabel = `${optionLabel} (${hoursLabel} suppl.)`;
      }
    }
    const offered = isLineOffered(opt);
    const originalTtc = offered
      ? roundMoney(Number(opt.unitPrice || 0) * Number(opt.billedUnits || opt.quantity || 0))
      : Number(opt.totalPrice || 0);
    drawRow(optionLabel, opt.billedUnits || opt.quantity || 1, Number(opt.totalPrice || 0), vatOptions, false, {
      originalTtc,
      badgeText: offered ? 'OFFERT' : '',
    });
  }

  // Resources
  for (const rsc of full.resources || []) {
    const offered = isLineOffered(rsc);
    const originalTtc = offered
      ? roundMoney(Number(rsc.unitPrice || 0) * Number(rsc.billedUnits || rsc.quantity || 0))
      : Number(rsc.totalPrice || 0);
    drawRow(rsc.name || `Ressource #${rsc.resourceId}`, rsc.quantity || 1, Number(rsc.totalPrice || 0), vatResources, false, {
      originalTtc,
      badgeText: offered ? 'OFFERT' : '',
    });
  }

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
    doc.fontSize(10).fillColor(BRAND).font('Helvetica-Bold').text('COORDONNÉES BANCAIRES', LEFT, bankY, { width: LEFT_COL_W, align: 'left' });
    bankY += 14;
    doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica');
    if (settings.companyBankName) {
      doc.text(`Dénomination du compte : ${settings.companyBankName}`, LEFT, bankY, { width: LEFT_COL_W, align: 'left' });
      bankY += 13;
    }
    if (settings.companyBic) {
      doc.text(`BIC : ${settings.companyBic}`, LEFT, bankY, { width: LEFT_COL_W, align: 'left' });
      bankY += 13;
    }
    if (settings.companyIban) {
      doc.text(`IBAN : ${settings.companyIban}`, LEFT, bankY, { width: LEFT_COL_W, align: 'left' });
      bankY += 13;
    }

    // Discreet frame around bank details block.
    doc
      .roundedRect(LEFT - 4, bankTop - 4, LEFT_COL_W - 14, (bankY - bankTop) + 8, 3)
      .lineWidth(0.6)
      .strokeColor('#d6d6d6')
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

  drawTotalLine('Sous-total HT', subtotalHt, false);
  const subtotalTtc = roundMoney(subtotalTtcFromRows);
  drawTotalLine('Sous-total TTC', subtotalTtc, false);
  if (Number(full.touristTaxTotal || 0) > 0) {
    drawTotalLine('Taxe de séjour', full.touristTaxTotal, false);
    const taxablePersons = Number(full.adults || 0) + Number(full.children || 0) + Number(full.teens || 0);
    const taxNights = Math.max(0, diffDays(full.startDate, full.endDate));
    const taxRate = Number(full.touristTaxRate || 0);
    const taxDetail = `${taxablePersons} pers. × ${taxNights} nuit${taxNights > 1 ? 's' : ''} × ${formatCurrency(taxRate)} / pers./nuit`;
    doc.fontSize(8).fillColor(TEXT_LIGHT).font('Helvetica-Oblique')
      .text(taxDetail, TOTAL_RX, totY - 4, { width: TOTAL_LW - RIGHT_PAD, align: 'right' });
    totY += 10;
  }

  // Total line
  const grandTotalTtc = roundMoney(Number(full.finalPrice || 0) + Number(full.touristTaxTotal || 0));
  doc.rect(TOTAL_RX - 10, totY - 2, TOTAL_LW + 10, 24).fill(BRAND);
  doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold')
    .text('TOTAL TTC', TOTAL_RX - 4, totY + 4, { width: 120 });
  doc.text(formatCurrency(grandTotalTtc), TOTAL_RX + 120, totY + 4, { width: 80 - RIGHT_PAD, align: 'right' });
  totY += 30;
  totY = Math.max(totY, bankBottomY);

  // ── Payment schedule ──────────────────────────────────────────────────────
  totY = checkBreak(totY, 60);
  const PAY_TOP = totY + 14;
  doc.fontSize(11).fillColor(BRAND).font('Helvetica-Bold').text('MODALITÉS DE RÈGLEMENT', LEFT, PAY_TOP);
  doc.moveTo(LEFT, PAY_TOP + 15).lineTo(LEFT + PAGE_W, PAY_TOP + 15).strokeColor(BRAND).lineWidth(1.5).stroke();

  let py = PAY_TOP + 22;
  const payTextColor = TEXT_DARK;
  const depositAmt = Number(full.depositAmount || 0);
  const balanceAmt = Number(full.balanceAmount || 0);

  // Acompte (même logique que le résumé de réservation : montant + échéance)
  if (depositAmt > 0) {
    py = checkBreak(py, 34);
    doc.rect(LEFT, py, PAGE_W, 28).fill('#fff8e1');
    doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica').text('Acompte :', LEFT + 8, py + 7);
    doc.font('Helvetica-Bold').fillColor(payTextColor)
      .text(formatCurrency(depositAmt), LEFT + 70, py + 7);
    if (full.depositDueDate) {
      doc.font('Helvetica').fillColor(TEXT_LIGHT)
        .text(`À payer avant le ${formatDateFR(full.depositDueDate)}`, LEFT + 170, py + 7);
    }
    py += 34;
  }

  // Solde (même logique que le résumé de réservation : montant + échéance)
  if (balanceAmt > 0) {
    py = checkBreak(py, 30);
    doc.rect(LEFT, py, PAGE_W, 24).fill(LIGHT_GRAY);
    doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica').text('Solde :', LEFT + 8, py + 7);
    doc.font('Helvetica-Bold').fillColor(payTextColor)
      .text(formatCurrency(balanceAmt), LEFT + 70, py + 7);
    if (full.balanceDueDate) {
      doc.font('Helvetica').fillColor(TEXT_LIGHT)
        .text(`À payer avant le ${formatDateFR(full.balanceDueDate)}`, LEFT + 170, py + 7);
    }
    py += 30;
  }

  // Caution
  if (Number(full.cautionAmount || 0) > 0) {
    py = checkBreak(py, 30);
    doc.rect(LEFT, py, PAGE_W, 24).fill('#e8f5e9');
    doc.fontSize(9).fillColor('#2e7d32').font('Helvetica').text('Caution :', LEFT + 8, py + 7);
    doc.font('Helvetica-Bold').fillColor(payTextColor)
      .text(`${formatCurrency(full.cautionAmount)} — à remettre le jour de votre arrivée`, LEFT + 70, py + 7);
    py += 30;
  }

  // ── Custom footer text ────────────────────────────────────────────────────
  const footerText = settings.quoteFooterText ||
    'Nous vous remercions de votre intérêt et restons à votre disposition pour tout renseignement complémentaire. ' +
    'Dans l\'attente de votre confirmation, nous vous souhaitons une excellente journée.';

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
  if (settings.companySiret) legalParts.push(`SIRET : ${settings.companySiret}`);
  if (settings.companyTva) legalParts.push(`N° TVA : ${settings.companyTva}`);
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
      doc.fontSize(7.5).fillColor('#888888').font('Helvetica-Bold')
        .text(settings.companyName, LEFT, ftY, { width: PAGE_W * 0.25, ellipsis: true });
    }
    // Center: SIRET / TVA — wide column + no wrap so both stay on a single line.
    if (legalCenter) {
      doc.fontSize(7.5).fillColor('#888888').font('Helvetica')
        .text(legalCenter, LEFT + PAGE_W * 0.25, ftY, { width: PAGE_W * 0.5, align: 'center', lineBreak: false });
    }
    // Right: page X / N
    doc.fontSize(7.5).fillColor('#888888').font('Helvetica')
      .text(`Page ${i + 1} / ${totalPages}`, LEFT + PAGE_W * 0.75, ftY, { width: PAGE_W * 0.25, align: 'right' });
  }

  doc.flushPages();
  doc.end();
  });
}

module.exports = { generateDevisPdf };
