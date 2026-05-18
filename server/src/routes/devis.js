const router = require('express').Router();
const db = require('../database');
const PDFDocument = require('pdfkit');
const { calculateReservationQuote } = require('../utils/pricing');

// ─── helpers ────────────────────────────────────────────────────────────────

function roundMoney(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

function formatDateFR(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = String(dateStr).split('-');
  return `${d}/${m}/${y}`;
}

function formatCurrency(amount) {
  return `${Number(amount || 0).toFixed(2).replace('.', ',')} €`;
}

function diffDays(startDate, endDate) {
  const s = new Date(`${startDate}T00:00:00`);
  const e = new Date(`${endDate}T00:00:00`);
  return Math.round((e - s) / 86400000);
}

function enrichDevis(row) {
  if (!row) return null;
  const options = db.prepare(`
    SELECT do.*, o.title, o.priceType as optionPriceType
    FROM devis_options do
    JOIN options o ON do.optionId = o.id
    WHERE do.devisId = ?
  `).all(row.id);
  const resources = db.prepare(`
    SELECT dr.*, r.name, r.priceType as resourcePriceType
    FROM devis_resources dr
    JOIN resources r ON dr.resourceId = r.id
    WHERE dr.devisId = ?
  `).all(row.id);
  const nights = db.prepare(`
    SELECT * FROM devis_nights WHERE devisId = ? ORDER BY date
  `).all(row.id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(row.clientId);
  const property = db.prepare('SELECT id, name, defaultCheckIn AS checkInTime, defaultCheckOut AS checkOutTime, defaultCautionAmount, vatPercentageAccommodation, vatPercentageOptions, vatPercentageResources FROM properties WHERE id = ?').get(row.propertyId);
  return { ...row, options, resources, nights, client, property };
}

// ─── list ────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const { propertyId, status, from, to } = req.query;
  let sql = `
    SELECT d.*, c.firstName, c.lastName, p.name as propertyName
    FROM devis d
    LEFT JOIN clients c ON d.clientId = c.id
    LEFT JOIN properties p ON d.propertyId = p.id
    WHERE 1=1
  `;
  const params = [];
  if (propertyId) { sql += ' AND d.propertyId = ?'; params.push(Number(propertyId)); }
  if (status) { sql += ' AND d.status = ?'; params.push(status); }
  if (from) { sql += ' AND d.endDate >= ?'; params.push(from); }
  if (to) { sql += ' AND d.startDate <= ?'; params.push(to); }
  sql += ' ORDER BY d.createdAt DESC';
  const rows = db.prepare(sql).all(...params);
  return res.json(rows);
});

// ─── single ──────────────────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM devis WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Devis non trouvé' });
  return res.json(enrichDevis(row));
});

// ─── create ──────────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const body = req.body;
  if (!body.propertyId || !body.clientId || !body.startDate || !body.endDate) {
    return res.status(400).json({ error: 'propertyId, clientId, startDate et endDate sont requis' });
  }

  // Calculate quote from pricing engine
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(Number(body.propertyId));
  if (!property) return res.status(404).json({ error: 'Logement introuvable' });

  const selectedOptions = (body.selectedOptions || []).map((o) => ({
    optionId: Number(o.optionId),
    quantity: Number(o.quantity || 1),
    unitPrice: o.unitPrice != null ? Number(o.unitPrice) : undefined,
  }));
  const selectedResources = (body.selectedResources || []).map((r) => ({
    resourceId: Number(r.resourceId),
    quantity: Number(r.quantity || 1),
    unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined,
  }));

  const quote = calculateReservationQuote({
    db,
    propertyId: Number(body.propertyId),
    startDate: body.startDate,
    endDate: body.endDate,
    adults: Number(body.adults || 1),
    children: Number(body.children || 0),
    teens: Number(body.teens || 0),
    babies: Number(body.babies || 0),
    discountPercent: Number(body.discountPercent || 0),
    depositPercent: property.depositPercent,
    depositDaysBefore: property.depositDaysBefore,
    balanceDaysBefore: property.balanceDaysBefore,
    selectedOptions,
    selectedResources,
    customAccommodationPrice: body.customPrice != null && body.customPrice !== '' ? Number(body.customPrice) : undefined,
  });

  const devisNumber = db.generateDevisNumber();

  const insertStmt = db.prepare(`
    INSERT INTO devis (
      devisNumber, propertyId, clientId, status,
      startDate, endDate, adults, children, teens, babies,
      singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime,
      platform, totalPrice, touristTaxRate, touristTaxTotal,
      discountPercent, finalPrice, depositAmount, depositDueDate,
      balanceAmount, balanceDueDate, cautionAmount, notes, validUntil
    ) VALUES (
      ?, ?, ?, 'draft',
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `);

  const info = insertStmt.run(
    devisNumber,
    Number(body.propertyId),
    Number(body.clientId),
    body.startDate,
    body.endDate,
    Number(body.adults || 1),
    Number(body.children || 0),
    Number(body.teens || 0),
    Number(body.babies || 0),
    body.singleBeds != null && body.singleBeds !== '' ? Number(body.singleBeds) : null,
    body.doubleBeds != null && body.doubleBeds !== '' ? Number(body.doubleBeds) : null,
    body.babyBeds != null && body.babyBeds !== '' ? Number(body.babyBeds) : null,
    body.checkInTime || property.defaultCheckIn || '15:00',
    body.checkOutTime || property.defaultCheckOut || '10:00',
    body.platform || 'direct',
    roundMoney(quote.totalPrice),
    roundMoney(quote.touristTaxRate || 0),
    roundMoney(quote.touristTaxTotal || 0),
    Number(body.discountPercent || 0),
    roundMoney(quote.finalPrice),
    roundMoney(body.depositAmount != null ? body.depositAmount : quote.depositAmount),
    body.depositDueDate || quote.depositDueDate || null,
    roundMoney(body.balanceAmount != null ? body.balanceAmount : quote.balanceAmount),
    body.balanceDueDate || quote.balanceDueDate || null,
    roundMoney(body.cautionAmount != null ? body.cautionAmount : (property.defaultCautionAmount || 0)),
    String(body.notes || ''),
    body.validUntil || null,
  );
  const devisId = info.lastInsertRowid;

  // Insert options
  const insertOption = db.prepare(`
    INSERT INTO devis_options (devisId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of quote.optionLines || []) {
    insertOption.run(devisId, Number(line.optionId), Number(line.quantity || 1),
      roundMoney(line.unitPrice), roundMoney(line.billedUnits || 0),
      line.priceType || 'per_stay', roundMoney(line.totalPrice));
  }

  // Insert resources
  const insertResource = db.prepare(`
    INSERT INTO devis_resources (devisId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of quote.resourceLines || []) {
    insertResource.run(devisId, Number(line.resourceId), Number(line.quantity || 1),
      roundMoney(line.unitPrice), roundMoney(line.billedUnits || 0),
      line.priceType || 'per_stay', roundMoney(line.totalPrice));
  }

  // Insert nightly breakdown
  const insertNight = db.prepare(`
    INSERT INTO devis_nights (devisId, date, seasonLabel, pricingMode, price)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const night of quote.nightlyBreakdown || []) {
    insertNight.run(devisId, night.date, night.seasonLabel || 'Standard',
      night.pricingMode || 'fixed', roundMoney(night.price));
  }

  const created = db.prepare('SELECT * FROM devis WHERE id = ?').get(devisId);
  return res.status(201).json(enrichDevis(created));
});

// ─── update ──────────────────────────────────────────────────────────────────

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM devis WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Devis non trouvé' });

  const body = req.body;
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(
    Number(body.propertyId || existing.propertyId)
  );
  if (!property) return res.status(404).json({ error: 'Logement introuvable' });

  const selectedOptions = (body.selectedOptions || []).map((o) => ({
    optionId: Number(o.optionId),
    quantity: Number(o.quantity || 1),
    unitPrice: o.unitPrice != null ? Number(o.unitPrice) : undefined,
  }));
  const selectedResources = (body.selectedResources || []).map((r) => ({
    resourceId: Number(r.resourceId),
    quantity: Number(r.quantity || 1),
    unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined,
  }));

  const quote = calculateReservationQuote({
    db,
    propertyId: Number(body.propertyId || existing.propertyId),
    startDate: body.startDate || existing.startDate,
    endDate: body.endDate || existing.endDate,
    adults: Number(body.adults ?? existing.adults),
    children: Number(body.children ?? existing.children),
    teens: Number(body.teens ?? existing.teens),
    babies: Number(body.babies ?? existing.babies),
    discountPercent: Number(body.discountPercent ?? existing.discountPercent ?? 0),
    depositPercent: property.depositPercent,
    depositDaysBefore: property.depositDaysBefore,
    balanceDaysBefore: property.balanceDaysBefore,
    selectedOptions,
    selectedResources,
    customAccommodationPrice: body.customPrice != null && body.customPrice !== '' ? Number(body.customPrice) : undefined,
  });

  db.prepare(`
    UPDATE devis SET
      propertyId = ?, clientId = ?, status = ?,
      startDate = ?, endDate = ?,
      adults = ?, children = ?, teens = ?, babies = ?,
      singleBeds = ?, doubleBeds = ?, babyBeds = ?,
      checkInTime = ?, checkOutTime = ?, platform = ?,
      totalPrice = ?, touristTaxRate = ?, touristTaxTotal = ?,
      discountPercent = ?, finalPrice = ?,
      depositAmount = ?, depositDueDate = ?,
      balanceAmount = ?, balanceDueDate = ?,
      cautionAmount = ?, notes = ?, validUntil = ?,
      updatedAt = datetime('now')
    WHERE id = ?
  `).run(
    Number(body.propertyId || existing.propertyId),
    Number(body.clientId || existing.clientId),
    body.status || existing.status,
    body.startDate || existing.startDate,
    body.endDate || existing.endDate,
    Number(body.adults ?? existing.adults),
    Number(body.children ?? existing.children),
    Number(body.teens ?? existing.teens),
    Number(body.babies ?? existing.babies),
    body.singleBeds != null && body.singleBeds !== '' ? Number(body.singleBeds) : null,
    body.doubleBeds != null && body.doubleBeds !== '' ? Number(body.doubleBeds) : null,
    body.babyBeds != null && body.babyBeds !== '' ? Number(body.babyBeds) : null,
    body.checkInTime || existing.checkInTime,
    body.checkOutTime || existing.checkOutTime,
    body.platform || existing.platform,
    roundMoney(quote.totalPrice),
    roundMoney(quote.touristTaxRate || 0),
    roundMoney(quote.touristTaxTotal || 0),
    Number(body.discountPercent ?? existing.discountPercent ?? 0),
    roundMoney(quote.finalPrice),
    roundMoney(body.depositAmount != null ? body.depositAmount : quote.depositAmount),
    body.depositDueDate !== undefined ? body.depositDueDate : existing.depositDueDate,
    roundMoney(body.balanceAmount != null ? body.balanceAmount : quote.balanceAmount),
    body.balanceDueDate !== undefined ? body.balanceDueDate : existing.balanceDueDate,
    roundMoney(body.cautionAmount ?? existing.cautionAmount ?? 0),
    String(body.notes ?? existing.notes ?? ''),
    body.validUntil !== undefined ? body.validUntil : existing.validUntil,
    id,
  );

  // Replace options
  db.prepare('DELETE FROM devis_options WHERE devisId = ?').run(id);
  const insertOption = db.prepare(`
    INSERT INTO devis_options (devisId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of quote.optionLines || []) {
    insertOption.run(id, Number(line.optionId), Number(line.quantity || 1),
      roundMoney(line.unitPrice), roundMoney(line.billedUnits || 0),
      line.priceType || 'per_stay', roundMoney(line.totalPrice));
  }

  // Replace resources
  db.prepare('DELETE FROM devis_resources WHERE devisId = ?').run(id);
  const insertResource = db.prepare(`
    INSERT INTO devis_resources (devisId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of quote.resourceLines || []) {
    insertResource.run(id, Number(line.resourceId), Number(line.quantity || 1),
      roundMoney(line.unitPrice), roundMoney(line.billedUnits || 0),
      line.priceType || 'per_stay', roundMoney(line.totalPrice));
  }

  // Replace nights
  db.prepare('DELETE FROM devis_nights WHERE devisId = ?').run(id);
  const insertNight = db.prepare(`
    INSERT INTO devis_nights (devisId, date, seasonLabel, pricingMode, price)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const night of quote.nightlyBreakdown || []) {
    insertNight.run(id, night.date, night.seasonLabel || 'Standard',
      night.pricingMode || 'fixed', roundMoney(night.price));
  }

  return res.json(enrichDevis(db.prepare('SELECT * FROM devis WHERE id = ?').get(id)));
});

// ─── delete ──────────────────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM devis WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Devis non trouvé' });
  db.prepare('DELETE FROM devis WHERE id = ?').run(id);
  return res.json({ success: true });
});

// ─── convert devis → reservation ─────────────────────────────────────────────

router.post('/:id/convert-to-reservation', (req, res) => {
  const id = Number(req.params.id);
  const devisRow = db.prepare('SELECT * FROM devis WHERE id = ?').get(id);
  if (!devisRow) return res.status(404).json({ error: 'Devis non trouvé' });
  if (devisRow.convertedReservationId) {
    return res.status(400).json({ error: 'Ce devis a déjà été converti en réservation' });
  }

  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(devisRow.propertyId);
  if (!property) return res.status(404).json({ error: 'Logement introuvable' });

  const devisOptions = db.prepare('SELECT * FROM devis_options WHERE devisId = ?').all(id);
  const devisResources = db.prepare('SELECT * FROM devis_resources WHERE devisId = ?').all(id);

  const insertRes = db.prepare(`
    INSERT INTO reservations (
      propertyId, clientId, startDate, endDate,
      adults, children, teens, babies,
      singleBeds, doubleBeds, babyBeds,
      checkInTime, checkOutTime, platform,
      totalPrice, touristTaxRate, touristTaxTotal,
      discountPercent, finalPrice,
      depositAmount, depositDueDate, depositPaid,
      balanceAmount, balanceDueDate, balancePaid,
      cautionAmount, notes, sourceType
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?,
      ?, ?, 0,
      ?, ?, 0,
      ?, ?, 'manual'
    )
  `);

  const info = insertRes.run(
    devisRow.propertyId,
    devisRow.clientId,
    devisRow.startDate,
    devisRow.endDate,
    devisRow.adults,
    devisRow.children,
    devisRow.teens,
    devisRow.babies,
    devisRow.singleBeds,
    devisRow.doubleBeds,
    devisRow.babyBeds,
    devisRow.checkInTime,
    devisRow.checkOutTime,
    devisRow.platform,
    devisRow.totalPrice,
    devisRow.touristTaxRate,
    devisRow.touristTaxTotal,
    devisRow.discountPercent,
    devisRow.finalPrice,
    devisRow.depositAmount,
    devisRow.depositDueDate,
    devisRow.balanceAmount,
    devisRow.balanceDueDate,
    devisRow.cautionAmount,
    devisRow.notes,
  );
  const reservationId = info.lastInsertRowid;

  // Copy options
  const insertOpt = db.prepare(`
    INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const o of devisOptions) {
    insertOpt.run(reservationId, o.optionId, o.quantity, o.unitPrice, o.billedUnits, o.priceType, o.totalPrice);
  }

  // Copy resources
  const insertRsc = db.prepare(`
    INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of devisResources) {
    insertRsc.run(reservationId, r.resourceId, r.quantity, r.unitPrice, r.billedUnits, r.priceType, r.totalPrice);
  }

  // Copy nights
  const devisNights = db.prepare('SELECT * FROM devis_nights WHERE devisId = ?').all(id);
  const insertNight = db.prepare(`
    INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const n of devisNights) {
    insertNight.run(reservationId, n.date, n.seasonLabel, n.pricingMode, n.price);
  }

  // Mark devis as converted
  db.prepare(`
    UPDATE devis SET status = 'converted', convertedReservationId = ?, updatedAt = datetime('now')
    WHERE id = ?
  `).run(reservationId, id);

  return res.json({ success: true, reservationId });
});

// ─── convert reservation → devis ─────────────────────────────────────────────

router.post('/from-reservation/:reservationId', (req, res) => {
  const reservationId = Number(req.params.reservationId);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
  if (!reservation) return res.status(404).json({ error: 'Réservation introuvable' });

  const resOptions = db.prepare('SELECT * FROM reservation_options WHERE reservationId = ?').all(reservationId);
  const resResources = db.prepare('SELECT * FROM reservation_resources WHERE reservationId = ?').all(reservationId);
  const resNights = db.prepare('SELECT * FROM reservation_nights WHERE reservationId = ?').all(reservationId);

  const devisNumber = db.generateDevisNumber();

  const insertStmt = db.prepare(`
    INSERT INTO devis (
      devisNumber, propertyId, clientId, status,
      startDate, endDate, adults, children, teens, babies,
      singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime,
      platform, totalPrice, touristTaxRate, touristTaxTotal,
      discountPercent, finalPrice, depositAmount, depositDueDate,
      balanceAmount, balanceDueDate, cautionAmount, notes
    ) VALUES (
      ?, ?, ?, 'draft',
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  const info = insertStmt.run(
    devisNumber,
    reservation.propertyId,
    reservation.clientId,
    reservation.startDate,
    reservation.endDate,
    reservation.adults,
    reservation.children,
    reservation.teens,
    reservation.babies,
    reservation.singleBeds,
    reservation.doubleBeds,
    reservation.babyBeds,
    reservation.checkInTime,
    reservation.checkOutTime,
    reservation.platform,
    reservation.totalPrice,
    reservation.touristTaxRate,
    reservation.touristTaxTotal,
    reservation.discountPercent,
    reservation.finalPrice,
    reservation.depositAmount,
    reservation.depositDueDate,
    reservation.balanceAmount,
    reservation.balanceDueDate,
    reservation.cautionAmount || 0,
    reservation.notes,
  );
  const devisId = info.lastInsertRowid;

  const insertOpt = db.prepare(`
    INSERT INTO devis_options (devisId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const o of resOptions) {
    insertOpt.run(devisId, o.optionId, o.quantity, o.unitPrice, o.billedUnits, o.priceType, o.totalPrice);
  }

  const insertRsc = db.prepare(`
    INSERT INTO devis_resources (devisId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of resResources) {
    insertRsc.run(devisId, r.resourceId, r.quantity, r.unitPrice, r.billedUnits, r.priceType, r.totalPrice);
  }

  const insertNight = db.prepare(`
    INSERT INTO devis_nights (devisId, date, seasonLabel, pricingMode, price)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const n of resNights) {
    insertNight.run(devisId, n.date, n.seasonLabel, n.pricingMode, n.price);
  }

  const created = db.prepare('SELECT * FROM devis WHERE id = ?').get(devisId);
  return res.status(201).json(enrichDevis(created));
});

// ─── PDF generation ───────────────────────────────────────────────────────────

router.get('/:id/pdf', (req, res) => {
  const id = Number(req.params.id);
  const devisRow = db.prepare('SELECT * FROM devis WHERE id = ?').get(id);
  if (!devisRow) return res.status(404).json({ error: 'Devis non trouvé' });

  const full = enrichDevis(devisRow);
  const settings = db.getAppSettings();
  const property = full.property;
  const client = full.client;
  const vatAccommodation = Number(property?.vatPercentageAccommodation ?? 20);
  const vatOptions = Number(property?.vatPercentageOptions ?? 20);
  const vatResources = Number(property?.vatPercentageResources ?? 20);

  // Parse phone numbers
  let phones = [];
  try { phones = JSON.parse(client.phoneNumbers || '[]'); } catch (e) { /* ignore */ }
  if (!phones.length && client.phone) phones = [client.phone];

  const BRAND = '#1a3a5c';
  const LIGHT_GRAY = '#f5f5f5';
  const MID_GRAY = '#cccccc';
  const TEXT_DARK = '#222222';
  const TEXT_LIGHT = '#555555';

  const doc = new PDFDocument({
    size: 'A4',
    margin: 45,
    info: {
      Title: `Devis ${full.devisNumber}`,
      Author: settings.companyName || 'GuestFlow',
    },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="devis-${full.devisNumber}.pdf"`);
  doc.pipe(res);

  const PAGE_W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const LEFT = doc.page.margins.left;

  // ── Header band ──────────────────────────────────────────────────────────
  doc.rect(LEFT, 40, PAGE_W, 70).fill(BRAND);

  if (settings.companyName) {
    doc.fontSize(20).fillColor('#ffffff').font('Helvetica-Bold')
      .text(settings.companyName, LEFT + 12, 52, { width: PAGE_W * 0.55 });
  }

  // Devis title top-right
  doc.fontSize(18).fillColor('#ffffff').font('Helvetica-Bold')
    .text('DEVIS', LEFT + PAGE_W * 0.6, 52, { width: PAGE_W * 0.4, align: 'right' });
  doc.fontSize(10).fillColor('#cce0ff').font('Helvetica')
    .text(`N° ${full.devisNumber}`, LEFT + PAGE_W * 0.6, 76, { width: PAGE_W * 0.4, align: 'right' });

  // ── Company & client block ───────────────────────────────────────────────
  const INFO_TOP = 125;
  const COL2 = LEFT + PAGE_W * 0.55;

  // Company info (left)
  doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica-Bold').text('ÉMETTEUR', LEFT, INFO_TOP);
  let cy = INFO_TOP + 14;
  doc.fontSize(10).fillColor(TEXT_DARK).font('Helvetica-Bold');
  if (settings.companyName) {
    doc.text(settings.companyName, LEFT, cy); cy += 14;
  }
  doc.font('Helvetica').fontSize(9).fillColor(TEXT_LIGHT);
  if (settings.companyAddress) {
    const addrLines = settings.companyAddress.split('\n');
    for (const line of addrLines) {
      doc.text(line, LEFT, cy); cy += 13;
    }
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
    { label: 'Valable jusqu\'au', value: full.validUntil ? formatDateFR(full.validUntil) : 'Sur demande' },
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
  const sejItems = [
    ['Arrivée', `${formatDateFR(full.startDate)} à ${full.checkInTime || '15:00'}`],
    ['Départ', `${formatDateFR(full.endDate)} à ${full.checkOutTime || '10:00'}`],
    ['Durée', `${nights} nuit${nights > 1 ? 's' : ''}`],
    ['Adultes', String(full.adults || 0)],
  ];
  if (Number(full.teens || 0) > 0) sejItems.push(['Adolescents', String(full.teens)]);
  if (Number(full.children || 0) > 0) sejItems.push(['Enfants', String(full.children)]);
  if (Number(full.babies || 0) > 0) sejItems.push(['Bébés', String(full.babies)]);

  const colW = (PAGE_W - 12) / 4;
  let sx = LEFT;
  let sy = SEJ_TOP + 22;
  let itemInRow = 0;
  for (const [label, value] of sejItems) {
    doc.fontSize(8).fillColor(TEXT_LIGHT).font('Helvetica').text(label, sx, sy);
    doc.fontSize(10).fillColor(TEXT_DARK).font('Helvetica-Bold').text(value, sx, sy + 11, { width: colW });
    itemInRow++;
    if (itemInRow === 4) { sx = LEFT; sy += 38; itemInRow = 0; }
    else sx += colW + 4;
  }

  // ── Pricing table ─────────────────────────────────────────────────────────
  const TABLE_TOP = sy + (itemInRow > 0 ? 38 : 6) + 14;
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
  doc.text('Prix HT', COL_HT, TH + 5, { width: PAGE_W * 0.16, align: 'right' });
  doc.text('TVA %', COL_VAT, TH + 5, { width: PAGE_W * 0.1, align: 'center' });
  doc.text('Total TTC', COL_TOTAL, TH + 5, { width: PAGE_W * 0.14, align: 'right' });

  let rowY = TH + 18;
  let rowIdx = 0;
  let subtotalHt = 0;

  function drawRow(desc, qty, totalTtc, vatRate, italic) {
    const rowH = 20;
    if (rowIdx % 2 === 0) doc.rect(LEFT, rowY, PAGE_W, rowH).fill(LIGHT_GRAY);
    const rate = Number(vatRate || 0);
    const ht = rate > 0 ? roundMoney(Number(totalTtc || 0) / (1 + (rate / 100))) : roundMoney(Number(totalTtc || 0));
    subtotalHt += ht;
    doc.fontSize(9).fillColor(TEXT_DARK);
    if (italic) doc.font('Helvetica-Oblique'); else doc.font('Helvetica');
    doc.text(desc, COL_DESC + 4, rowY + 6, { width: PAGE_W * 0.48 });
    doc.font('Helvetica').text(String(qty), COL_QTY, rowY + 6, { width: PAGE_W * 0.1, align: 'center' });
    doc.text(formatCurrency(ht), COL_HT, rowY + 6, { width: PAGE_W * 0.16, align: 'right' });
    doc.text(`${rate.toFixed(2).replace('.', ',')}%`, COL_VAT, rowY + 6, { width: PAGE_W * 0.1, align: 'center' });
    doc.font('Helvetica-Bold').text(formatCurrency(totalTtc), COL_TOTAL, rowY + 6, { width: PAGE_W * 0.14, align: 'right' });
    rowY += rowH;
    rowIdx++;
  }

  // Nights breakdown
  if (full.nights && full.nights.length > 0) {
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
    for (const g of groups) {
      const label = g.count === 1
        ? `Nuit du ${formatDateFR(g.firstDate)} (${g.seasonLabel})`
        : `${g.count} nuits — ${g.seasonLabel} (${formatDateFR(g.firstDate)} → ${formatDateFR(g.lastDate)})`;
      drawRow(label, g.count, g.totalPrice, vatAccommodation, false);
    }
  } else {
    // Flat accommodation row
    const accTotal = roundMoney((full.totalPrice || 0) - (full.options || []).reduce((s, o) => s + o.totalPrice, 0) - (full.resources || []).reduce((s, r) => s + r.totalPrice, 0));
    drawRow(`Hébergement — ${nights} nuit${nights > 1 ? 's' : ''}`, nights, accTotal, vatAccommodation, false);
  }

  // Options
  for (const opt of full.options || []) {
    drawRow(opt.title || `Option #${opt.optionId}`, opt.billedUnits || opt.quantity || 1, opt.totalPrice, vatOptions, false);
  }

  // Resources
  for (const rsc of full.resources || []) {
    drawRow(rsc.name || `Ressource #${rsc.resourceId}`, rsc.quantity || 1, rsc.totalPrice, vatResources, false);
  }

  // Table bottom border
  doc.moveTo(LEFT, rowY).lineTo(LEFT + PAGE_W, rowY).strokeColor(MID_GRAY).lineWidth(0.5).stroke();

  // ── Totals ────────────────────────────────────────────────────────────────
  let totY = rowY + 10;
  const TOTAL_LW = 200;
  const TOTAL_RX = LEFT + PAGE_W - TOTAL_LW;

  function drawTotalLine(label, amount, bold) {
    doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica').text(label, TOTAL_RX, totY, { width: 120 });
    if (bold) doc.font('Helvetica-Bold').fillColor(TEXT_DARK);
    else doc.font('Helvetica').fillColor(TEXT_DARK);
    doc.text(formatCurrency(amount), TOTAL_RX + 120, totY, { width: 80, align: 'right' });
    totY += 16;
  }

  drawTotalLine('Sous-total HT', subtotalHt, false);
  const subtotalTtc = roundMoney((full.totalPrice || 0) + (full.options || []).reduce((s, o) => s + o.totalPrice, 0) + (full.resources || []).reduce((s, r) => s + r.totalPrice, 0));
  drawTotalLine('Sous-total TTC', subtotalTtc, false);
  if (Number(full.discountPercent || 0) > 0) {
    drawTotalLine(`Remise (${full.discountPercent}%)`, -(subtotalTtc * full.discountPercent / 100), false);
  }
  if (Number(full.touristTaxTotal || 0) > 0) {
    drawTotalLine('Taxe de séjour', full.touristTaxTotal, false);
    const taxablePersons = Number(full.adults || 0) + Number(full.children || 0) + Number(full.teens || 0);
    const taxNights = Math.max(0, diffDays(full.startDate, full.endDate));
    const taxRate = Number(full.touristTaxRate || 0);
    const taxDetail = `${taxablePersons} pers. × ${taxNights} nuit${taxNights > 1 ? 's' : ''} × ${formatCurrency(taxRate)} / pers./nuit`;
    doc.fontSize(8).fillColor(TEXT_LIGHT).font('Helvetica-Oblique')
      .text(taxDetail, TOTAL_RX, totY - 4, { width: TOTAL_LW, align: 'right' });
    totY += 10;
  }

  // Total line
  const grandTotalTtc = roundMoney(Number(full.finalPrice || 0) + Number(full.touristTaxTotal || 0));
  doc.rect(TOTAL_RX - 10, totY - 2, TOTAL_LW + 10, 24).fill(BRAND);
  doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold')
    .text('TOTAL TTC', TOTAL_RX - 4, totY + 4, { width: 120 });
  doc.text(formatCurrency(grandTotalTtc), TOTAL_RX + 120, totY + 4, { width: 80, align: 'right' });
  totY += 30;

  // ── Payment schedule ──────────────────────────────────────────────────────
  const PAY_TOP = totY + 14;
  doc.fontSize(11).fillColor(BRAND).font('Helvetica-Bold').text('MODALITÉS DE RÈGLEMENT', LEFT, PAY_TOP);
  doc.moveTo(LEFT, PAY_TOP + 15).lineTo(LEFT + PAGE_W, PAY_TOP + 15).strokeColor(BRAND).lineWidth(1.5).stroke();

  let py = PAY_TOP + 22;
  const payTextColor = TEXT_DARK;

  // Deposit
  if (Number(full.depositAmount || 0) > 0) {
    doc.rect(LEFT, py, PAGE_W, 32).fill('#fff8e1');
    doc.fontSize(9).fillColor('#e65100').font('Helvetica-Bold')
      .text('ACOMPTE POUR CONFIRMER LA RÉSERVATION', LEFT + 8, py + 5);
    doc.font('Helvetica').fillColor(payTextColor).fontSize(9)
      .text(
        `Merci de bien vouloir régler un acompte de ${formatCurrency(full.depositAmount)}` +
        (full.depositDueDate ? ` avant le ${formatDateFR(full.depositDueDate)}` : '') +
        ' afin de confirmer votre réservation et de bloquer vos dates.',
        LEFT + 8, py + 17, { width: PAGE_W - 16 }
      );
    py += 38;
  }

  // Balance
  if (Number(full.balanceAmount || 0) > 0) {
    doc.rect(LEFT, py, PAGE_W, 24).fill(LIGHT_GRAY);
    doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica').text('Solde :', LEFT + 8, py + 7);
    doc.fillColor(payTextColor).font('Helvetica-Bold')
      .text(formatCurrency(full.balanceAmount), LEFT + 60, py + 7);
    doc.font('Helvetica').fillColor(TEXT_LIGHT)
      .text(full.balanceDueDate ? `à régler avant le ${formatDateFR(full.balanceDueDate)}` : '', LEFT + 130, py + 7);
    py += 30;
  }

  // Caution
  if (Number(full.cautionAmount || 0) > 0) {
    doc.rect(LEFT, py, PAGE_W, 24).fill('#e8f5e9');
    doc.fontSize(9).fillColor('#2e7d32').font('Helvetica').text('Caution :', LEFT + 8, py + 7);
    doc.font('Helvetica-Bold').fillColor(payTextColor)
      .text(`${formatCurrency(full.cautionAmount)} — à remettre le jour de votre arrivée`, LEFT + 70, py + 7);
    py += 30;
  }

  // RIB / bank details
  if (settings.companyIban || settings.companyBic || settings.companyBankName) {
    py += 8;
    doc.fontSize(10).fillColor(BRAND).font('Helvetica-Bold').text('COORDONNÉES BANCAIRES', LEFT, py); py += 14;
    doc.fontSize(9).fillColor(TEXT_DARK).font('Helvetica');
    if (settings.companyBankName) { doc.text(`Banque : ${settings.companyBankName}`, LEFT, py); py += 13; }
    if (settings.companyIban) { doc.text(`IBAN : ${settings.companyIban}`, LEFT, py); py += 13; }
    if (settings.companyBic) { doc.text(`BIC : ${settings.companyBic}`, LEFT, py); py += 13; }
  }

  // ── Custom footer text ────────────────────────────────────────────────────
  const footerText = settings.quoteFooterText ||
    'Nous vous remercions de votre intérêt et restons à votre disposition pour tout renseignement complémentaire. ' +
    'Dans l\'attente de votre confirmation, nous vous souhaitons une excellente journée.';

  if (footerText.trim()) {
    py += 14;
    doc.rect(LEFT, py, PAGE_W, 1).fill(MID_GRAY);
    py += 8;
    doc.fontSize(9).fillColor(TEXT_LIGHT).font('Helvetica-Oblique')
      .text(footerText, LEFT, py, { width: PAGE_W, align: 'justify' });
    py += doc.heightOfString(footerText, { width: PAGE_W }) + 6;
  }

  // ── Legal footer (Siret / TVA) ─────────────────────────────────────────────
  const legalParts = [];
  if (settings.companySiret) legalParts.push(`SIRET : ${settings.companySiret}`);
  if (settings.companyTva) legalParts.push(`N° TVA : ${settings.companyTva}`);

  if (legalParts.length > 0) {
    // Draw at absolute bottom
    const legalY = doc.page.height - doc.page.margins.bottom - 20;
    doc.rect(LEFT, legalY - 4, PAGE_W, 1).fill(MID_GRAY);
    doc.fontSize(7.5).fillColor('#888888').font('Helvetica')
      .text(legalParts.join('   •   '), LEFT, legalY, { width: PAGE_W, align: 'center' });
  }

  doc.end();
});

module.exports = router;
