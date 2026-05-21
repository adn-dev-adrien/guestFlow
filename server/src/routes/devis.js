const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const db = require('../database');
const PDFDocument = require('pdfkit');
const { calculateReservationQuote } = require('../utils/pricing');
const { sentenceCase } = require('../utils/textFormatters');

// ─── history helpers ────────────────────────────────────────────────────────

const DEVIS_HISTORY_FIELD_LABELS = {
  propertyId: 'Logement',
  clientId: 'Client',
  startDate: 'Date arrivée',
  endDate: 'Date départ',
  adults: 'Adultes',
  children: 'Enfants',
  teens: 'Ados',
  babies: 'Bébés',
  singleBeds: 'Lits simples',
  doubleBeds: 'Lits doubles',
  babyBeds: 'Lits bébé',
  checkInTime: 'Heure arrivée',
  checkOutTime: 'Heure départ',
  platform: 'Plateforme',
  totalPrice: 'Prix hébergement',
  customPrice: 'Prix personnalisé',
  touristTaxRate: 'Taux taxe de séjour',
  touristTaxTotal: 'Taxe de séjour',
  discountPercent: 'Réduction (%)',
  finalPrice: 'Prix final',
  depositAmount: 'Acompte',
  depositDueDate: 'Date acompte',
  balanceAmount: 'Solde',
  balanceDueDate: 'Date solde',
  status: 'Statut',
  notes: 'Notes',
};

function normalizeDevisHistoryValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Math.round(value * 100) / 100;
  return value;
}

function getDevisAuditSnapshotFromDb(devisId) {
  const row = db.prepare('SELECT * FROM devis WHERE id = ?').get(devisId);
  if (!row) return null;
  return {
    propertyId: Number(row.propertyId),
    clientId: Number(row.clientId),
    startDate: row.startDate || null,
    endDate: row.endDate || null,
    adults: Number(row.adults || 0),
    children: Number(row.children || 0),
    teens: Number(row.teens || 0),
    babies: Number(row.babies || 0),
    singleBeds: row.singleBeds === null ? null : Number(row.singleBeds),
    doubleBeds: row.doubleBeds === null ? null : Number(row.doubleBeds),
    babyBeds: row.babyBeds === null ? null : Number(row.babyBeds),
    checkInTime: row.checkInTime || null,
    checkOutTime: row.checkOutTime || null,
    platform: row.platform || null,
    totalPrice: Number(row.totalPrice || 0),
    customPrice: row.customPrice == null ? null : Number(row.customPrice),
    touristTaxRate: Number(row.touristTaxRate || 0),
    touristTaxTotal: Number(row.touristTaxTotal || 0),
    discountPercent: Number(row.discountPercent || 0),
    finalPrice: Number(row.finalPrice || 0),
    depositAmount: Number(row.depositAmount || 0),
    depositDueDate: row.depositDueDate || null,
    balanceAmount: Number(row.balanceAmount || 0),
    balanceDueDate: row.balanceDueDate || null,
    status: row.status || null,
    notes: row.notes || null,
  };
}

function getDevisAuditSnapshotFromPayload(payload, quote) {
  return {
    propertyId: Number(payload.propertyId),
    clientId: Number(payload.clientId),
    startDate: payload.startDate || null,
    endDate: payload.endDate || null,
    adults: Number(payload.adults || 0),
    children: Number(payload.children || 0),
    teens: Number(payload.teens || 0),
    babies: Number(payload.babies || 0),
    singleBeds: payload.singleBeds === null || payload.singleBeds === undefined || payload.singleBeds === '' ? null : Number(payload.singleBeds),
    doubleBeds: payload.doubleBeds === null || payload.doubleBeds === undefined || payload.doubleBeds === '' ? null : Number(payload.doubleBeds),
    babyBeds: payload.babyBeds === null || payload.babyBeds === undefined || payload.babyBeds === '' ? null : Number(payload.babyBeds),
    checkInTime: payload.checkInTime || null,
    checkOutTime: payload.checkOutTime || null,
    platform: payload.platform || null,
    totalPrice: quote.totalPrice == null ? null : Number(quote.totalPrice),
    customPrice: payload.customPrice === undefined || payload.customPrice === null || payload.customPrice === '' ? null : Number(payload.customPrice),
    touristTaxRate: Number(quote.touristTaxRate || 0),
    touristTaxTotal: Number(quote.touristTaxTotal || 0),
    discountPercent: Number(payload.discountPercent || 0),
    finalPrice: quote.finalPrice == null ? null : Number(quote.finalPrice),
    depositAmount: Number(quote.depositAmount || 0),
    depositDueDate: quote.depositDueDate || payload.depositDueDate || null,
    balanceAmount: Number(quote.balanceAmount || 0),
    balanceDueDate: quote.balanceDueDate || payload.balanceDueDate || null,
    status: payload.status || null,
    notes: sentenceCase(payload.notes) || null,
  };
}

function computeDevisAuditChanges(beforeSnapshot, afterSnapshot) {
  const keys = Object.keys(DEVIS_HISTORY_FIELD_LABELS);
  const changes = [];
  keys.forEach((key) => {
    const beforeValue = normalizeDevisHistoryValue(beforeSnapshot?.[key]);
    const afterValue = normalizeDevisHistoryValue(afterSnapshot?.[key]);
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes.push({
        field: key,
        label: DEVIS_HISTORY_FIELD_LABELS[key] || key,
        from: beforeValue,
        to: afterValue,
      });
    }
  });
  return changes;
}

function addDevisHistoryEntry(devisId, eventType, changes) {
  db.prepare('INSERT INTO devis_history (devisId, eventType, changedFields) VALUES (?, ?, ?)')
    .run(devisId, eventType, JSON.stringify(changes || []));
}

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

function isLineOffered(line) {
  const total = Number(line?.totalPrice || 0);
  const billedUnits = Number(line?.billedUnits || line?.quantity || 0);
  const unitPrice = Number(line?.unitPrice || 0);
  return total === 0 && billedUnits > 0 && unitPrice > 0;
}

function timeToDecimalHour(timeStr, fallback = 0) {
  const value = String(timeStr || '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return Number(fallback || 0);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number(fallback || 0);
  return hours + minutes / 60;
}

function formatHoursLabel(hoursValue) {
  const hours = Number(hoursValue || 0);
  if (!Number.isFinite(hours) || hours <= 0) return '';
  const rounded = Math.round(hours * 10) / 10;
  const display = Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace('.', ',');
  return `${display}h`;
}

function diffDays(startDate, endDate) {
  const s = new Date(`${startDate}T00:00:00`);
  const e = new Date(`${endDate}T00:00:00`);
  return Math.round((e - s) / 86400000);
}

function addDaysToIsoDate(isoDate, daysDelta) {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + Number(daysDelta || 0));
  return formatDate(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function resolvePaymentSchedule(row, property) {
  const totalStayPrice = roundMoney(Number(row.finalPrice || 0) + Number(row.touristTaxTotal || 0));
  const depositPercent = Number(property?.depositPercent || 0);
  const depositAmount = roundMoney(totalStayPrice * (depositPercent / 100));
  const balanceAmount = roundMoney(totalStayPrice - depositAmount);
  const depositDueDate = row.startDate
    ? addDaysToIsoDate(row.startDate, -Number(property?.depositDaysBefore || 0))
    : null;
  const balanceDueDate = row.startDate
    ? addDaysToIsoDate(row.startDate, -Number(property?.balanceDaysBefore || 0))
    : null;

  return {
    depositAmount,
    balanceAmount,
    depositDueDate,
    balanceDueDate,
    totalStayPrice,
  };
}

function enrichDevis(row) {
  if (!row) return null;
  const options = db.prepare(`
    SELECT do.*, o.title, o.priceType as optionPriceType, o.autoOptionType, o.autoFullNightThreshold,
      COALESCE(
        NULLIF(do.totalPrice, 0),
        NULLIF(round(COALESCE(do.unitPrice, 0) * COALESCE(do.billedUnits, do.quantity, 0), 2), 0),
        round(COALESCE(o.price, 0) * COALESCE(do.billedUnits, do.quantity, 0), 2)
      ) as originalTotalPrice,
      COALESCE(do.offered, CASE WHEN COALESCE(do.totalPrice, 0) = 0 AND COALESCE(do.unitPrice, 0) > 0 THEN 1 ELSE 0 END) as offered
    FROM devis_options do
    JOIN options o ON do.optionId = o.id
    WHERE do.devisId = ?
  `).all(row.id);
  const customOptions = db.prepare(`
    SELECT dco.id as customOptionId, dco.description as title, dco.description, 1 as quantity,
      dco.amount as unitPrice, 1 as billedUnits, 'per_stay' as priceType,
      CASE WHEN COALESCE(dco.offered, 0) = 1 THEN 0 ELSE dco.amount END as totalPrice,
      dco.amount as originalTotalPrice,
      COALESCE(dco.offered, 0) as offered,
      1 as isCustom
    FROM devis_custom_options dco
    WHERE dco.devisId = ?
    ORDER BY dco.sortOrder, dco.id
  `).all(row.id);
  const resources = db.prepare(`
    SELECT dr.*, r.name, r.priceType as resourcePriceType,
      COALESCE(dr.offered, CASE WHEN COALESCE(dr.totalPrice, 0) = 0 AND COALESCE(dr.unitPrice, 0) > 0 THEN 1 ELSE 0 END) as offered
    FROM devis_resources dr
    JOIN resources r ON dr.resourceId = r.id
    WHERE dr.devisId = ?
  `).all(row.id);
  const nights = db.prepare(`
    SELECT * FROM devis_nights WHERE devisId = ? ORDER BY date
  `).all(row.id);
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(row.clientId);
  const property = db.prepare('SELECT id, name, defaultCheckIn AS checkInTime, defaultCheckOut AS checkOutTime, defaultCautionAmount, vatPercentageAccommodation, vatPercentageOptions, vatPercentageResources, depositPercent, depositDaysBefore, balanceDaysBefore FROM properties WHERE id = ?').get(row.propertyId);
  const schedule = resolvePaymentSchedule(row, property);
  return { ...row, ...schedule, options: [...options, ...customOptions], resources, nights, client, property };
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

// ─── status update (safe) ───────────────────────────────────────────────────

router.patch('/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM devis WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Devis non trouvé' });

  const allowed = new Set(['draft', 'sent', 'accepted']);
  const status = String(req.body?.status || '').trim();
  if (!allowed.has(status)) {
    return res.status(400).json({ error: 'Statut invalide' });
  }
  if (existing.status === 'converted') {
    return res.status(400).json({ error: 'Un devis converti ne peut plus changer de statut' });
  }

  db.prepare('UPDATE devis SET status = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(status, id);
  const updated = db.prepare('SELECT * FROM devis WHERE id = ?').get(id);
  
  // Add history entry for status change
  const beforeSnapshot = getDevisAuditSnapshotFromDb(id);
  beforeSnapshot.status = existing.status;
  const afterSnapshot = getDevisAuditSnapshotFromDb(id);
  const statusChanges = computeDevisAuditChanges(beforeSnapshot, afterSnapshot);
  if (statusChanges.length > 0) {
    addDevisHistoryEntry(id, 'update', statusChanges);
  }
  
  return res.json(enrichDevis(updated));
});

// ─── history ─────────────────────────────────────────────────────────────────

router.get('/:id/history', (req, res) => {
  const id = Number(req.params.id);
  const devis = db.prepare('SELECT * FROM devis WHERE id = ?').get(id);
  if (!devis) {
    return res.status(404).json({ error: 'Devis non trouvé' });
  }

  const rows = db.prepare(`
    SELECT id, eventType, changedFields, createdAt
    FROM devis_history
    WHERE devisId = ?
    ORDER BY createdAt DESC
  `).all(id);

  const history = rows.map((row) => {
    let changes = [];
    try {
      changes = JSON.parse(row.changedFields || '[]');
    } catch {
      changes = [];
    }
    return {
      id: row.id,
      eventType: row.eventType,
      createdAt: row.createdAt,
      changes,
    };
  });

  res.json(history);
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

  const optionMetaById = new Map(
    db.prepare('SELECT id, autoOptionType FROM options').all().map((opt) => [Number(opt.id), opt])
  );
  const selectedOptions = (body.selectedOptions || []).map((o) => ({
    optionId: Number(o.optionId),
    quantity: Number(o.quantity || 1),
    unitPrice: o.unitPrice != null ? Number(o.unitPrice) : undefined,
  })).filter((line) => !optionMetaById.get(Number(line.optionId))?.autoOptionType);
  const customOptions = (body.customOptions || []).map((line, index) => ({
    customKey: String(line.customKey || `custom_${index + 1}`),
    description: String(line.description || '').trim(),
    amount: Number(line.amount || 0),
    offered: Boolean(line.offered),
  })).filter((line) => line.description && Number(line.amount || 0) > 0);
  const selectedResources = (body.selectedResources || []).map((r) => ({
    resourceId: Number(r.resourceId),
    quantity: Number(r.quantity || 1),
    unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined,
    offered: Boolean(r.offered),
  }));
  const lockedResourceLines = (body.selectedResources || [])
    .map((r) => ({
      resourceId: Number(r.resourceId),
      quantity: Number(r.quantity || 1),
      unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined,
      billedUnits: r.billedUnits != null ? Number(r.billedUnits) : Number(r.quantity || 1),
      priceType: r.priceType || 'per_stay',
      totalPrice: Number(r.totalPrice || 0),
      offered: Boolean(r.offered),
    }))
    .filter((line) => Number(line.totalPrice || 0) === 0 && Number(line.unitPrice || 0) > 0);

  const quote = calculateReservationQuote({
    db,
    propertyId: Number(body.propertyId),
    startDate: body.startDate,
    endDate: body.endDate,
    checkInTime: body.checkInTime || property.defaultCheckIn || '15:00',
    checkOutTime: body.checkOutTime || property.defaultCheckOut || '10:00',
    adults: Number(body.adults || 1),
    children: Number(body.children || 0),
    teens: Number(body.teens || 0),
    babies: Number(body.babies || 0),
    discountPercent: Number(body.discountPercent || 0),
    selectedOptions,
    customOptions,
    selectedResources,
    extraGuestSurchargeOffered: Boolean(body.extraGuestSurchargeOffered),
    customPrice: body.customPrice != null && body.customPrice !== '' ? Number(body.customPrice) : undefined,
    offeredOptionIds: body.offeredOptionIds,
    lockedResourceLines,
    platform: body.platform,
  });

  const devisNumber = db.generateDevisNumber();

  const insertStmt = db.prepare(`
    INSERT INTO devis (
      devisNumber, propertyId, clientId, status,
      startDate, endDate, adults, children, teens, babies,
      singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime,
      platform, totalPrice, touristTaxRate, touristTaxTotal,
      discountPercent, customPrice, finalPrice, depositAmount, depositDueDate,
      balanceAmount, balanceDueDate, cautionAmount, notes, validUntil
    ) VALUES (
      ?, ?, ?, 'draft',
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
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
    body.customPrice !== undefined && body.customPrice !== null && body.customPrice !== '' ? Number(body.customPrice) : null,
    roundMoney(quote.finalPrice),
    roundMoney(quote.depositAmount),
    quote.depositDueDate || null,
    roundMoney(quote.balanceAmount),
    quote.balanceDueDate || null,
    roundMoney(body.cautionAmount != null ? body.cautionAmount : (property.defaultCautionAmount || 0)),
    String(body.notes || ''),
    body.validUntil || null,
  );
  const devisId = info.lastInsertRowid;

  // Insert options
  const insertOption = db.prepare(`
    INSERT INTO devis_options (devisId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of (quote.optionLines || []).filter((item) => !item.isCustom)) {
    insertOption.run(devisId, Number(line.optionId), Number(line.quantity || 1),
      roundMoney(line.unitPrice), roundMoney(line.billedUnits || 0),
      line.priceType || 'per_stay', roundMoney(line.totalPrice), line.offered ? 1 : 0);
  }

  const insertCustomOption = db.prepare(`
    INSERT INTO devis_custom_options (devisId, description, amount, offered, sortOrder)
    VALUES (?, ?, ?, ?, ?)
  `);
  let customOrder = 0;
  for (const line of quote.optionLines || []) {
    if (!line.isCustom) continue;
    insertCustomOption.run(
      devisId,
      String(line.title || '').trim(),
      roundMoney(line.originalTotalPrice || line.totalPrice || 0),
      line.offered ? 1 : 0,
      customOrder,
    );
    customOrder += 1;
  }

  // Insert resources
  const insertResource = db.prepare(`
    INSERT INTO devis_resources (devisId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of quote.resourceLines || []) {
    insertResource.run(devisId, Number(line.resourceId), Number(line.quantity || 1),
      roundMoney(line.unitPrice), roundMoney(line.billedUnits || 0),
      line.priceType || 'per_stay', roundMoney(line.totalPrice), line.offered ? 1 : 0);
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
  
  // Add history entry for creation
  const afterSnapshot = getDevisAuditSnapshotFromDb(devisId);
  const changes = computeDevisAuditChanges({}, afterSnapshot);
  addDevisHistoryEntry(devisId, 'create', changes);
  
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

  const optionMetaById = new Map(
    db.prepare('SELECT id, autoOptionType FROM options').all().map((opt) => [Number(opt.id), opt])
  );
  const selectedOptions = (body.selectedOptions || []).map((o) => ({
    optionId: Number(o.optionId),
    quantity: Number(o.quantity || 1),
    unitPrice: o.unitPrice != null ? Number(o.unitPrice) : undefined,
  })).filter((line) => !optionMetaById.get(Number(line.optionId))?.autoOptionType);
  const customOptions = (body.customOptions || []).map((line, index) => ({
    customKey: String(line.customKey || `custom_${index + 1}`),
    description: String(line.description || '').trim(),
    amount: Number(line.amount || 0),
    offered: Boolean(line.offered),
  })).filter((line) => line.description && Number(line.amount || 0) > 0);
  const selectedResources = (body.selectedResources || []).map((r) => ({
    resourceId: Number(r.resourceId),
    quantity: Number(r.quantity || 1),
    unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined,
    offered: Boolean(r.offered),
  }));
  const lockedResourceLines = (body.selectedResources || [])
    .map((r) => ({
      resourceId: Number(r.resourceId),
      quantity: Number(r.quantity || 1),
      unitPrice: r.unitPrice != null ? Number(r.unitPrice) : undefined,
      billedUnits: r.billedUnits != null ? Number(r.billedUnits) : Number(r.quantity || 1),
      priceType: r.priceType || 'per_stay',
      totalPrice: Number(r.totalPrice || 0),
      offered: Boolean(r.offered),
    }))
    .filter((line) => Number(line.totalPrice || 0) === 0 && Number(line.unitPrice || 0) > 0);

  const quote = calculateReservationQuote({
    db,
    propertyId: Number(body.propertyId || existing.propertyId),
    startDate: body.startDate || existing.startDate,
    endDate: body.endDate || existing.endDate,
    checkInTime: body.checkInTime || existing.checkInTime || property.defaultCheckIn || '15:00',
    checkOutTime: body.checkOutTime || existing.checkOutTime || property.defaultCheckOut || '10:00',
    adults: Number(body.adults ?? existing.adults),
    children: Number(body.children ?? existing.children),
    teens: Number(body.teens ?? existing.teens),
    babies: Number(body.babies ?? existing.babies),
    discountPercent: Number(body.discountPercent ?? existing.discountPercent ?? 0),
    selectedOptions,
    customOptions,
    selectedResources,
    extraGuestSurchargeOffered: Boolean(body.extraGuestSurchargeOffered),
    customPrice: body.customPrice != null && body.customPrice !== '' ? Number(body.customPrice) : undefined,
    offeredOptionIds: body.offeredOptionIds,
    lockedResourceLines,
    platform: body.platform || existing.platform,
  });

  db.prepare(`
    UPDATE devis SET
      propertyId = ?, clientId = ?, status = ?,
      startDate = ?, endDate = ?,
      adults = ?, children = ?, teens = ?, babies = ?,
      singleBeds = ?, doubleBeds = ?, babyBeds = ?,
      checkInTime = ?, checkOutTime = ?, platform = ?,
      totalPrice = ?, touristTaxRate = ?, touristTaxTotal = ?,
      discountPercent = ?, customPrice = ?, finalPrice = ?,
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
    body.customPrice !== undefined && body.customPrice !== null && body.customPrice !== '' ? Number(body.customPrice) : (existing.customPrice == null ? null : Number(existing.customPrice)),
    roundMoney(quote.finalPrice),
    roundMoney(quote.depositAmount),
    quote.depositDueDate || null,
    roundMoney(quote.balanceAmount),
    quote.balanceDueDate || null,
    roundMoney(body.cautionAmount ?? existing.cautionAmount ?? 0),
    String(body.notes ?? existing.notes ?? ''),
    body.validUntil !== undefined ? body.validUntil : existing.validUntil,
    id,
  );

  // Replace options
  db.prepare('DELETE FROM devis_options WHERE devisId = ?').run(id);
  const insertOption = db.prepare(`
    INSERT INTO devis_options (devisId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of (quote.optionLines || []).filter((item) => !item.isCustom)) {
    insertOption.run(id, Number(line.optionId), Number(line.quantity || 1),
      roundMoney(line.unitPrice), roundMoney(line.billedUnits || 0),
      line.priceType || 'per_stay', roundMoney(line.totalPrice), line.offered ? 1 : 0);
  }

  db.prepare('DELETE FROM devis_custom_options WHERE devisId = ?').run(id);
  const insertCustomOption = db.prepare(`
    INSERT INTO devis_custom_options (devisId, description, amount, offered, sortOrder)
    VALUES (?, ?, ?, ?, ?)
  `);
  let customOrder = 0;
  for (const line of quote.optionLines || []) {
    if (!line.isCustom) continue;
    insertCustomOption.run(
      id,
      String(line.title || '').trim(),
      roundMoney(line.originalTotalPrice || line.totalPrice || 0),
      line.offered ? 1 : 0,
      customOrder,
    );
    customOrder += 1;
  }

  // Replace resources
  db.prepare('DELETE FROM devis_resources WHERE devisId = ?').run(id);
  const insertResource = db.prepare(`
    INSERT INTO devis_resources (devisId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const line of quote.resourceLines || []) {
    insertResource.run(id, Number(line.resourceId), Number(line.quantity || 1),
      roundMoney(line.unitPrice), roundMoney(line.billedUnits || 0),
      line.priceType || 'per_stay', roundMoney(line.totalPrice), line.offered ? 1 : 0);
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

  // Add history entry for update
  const beforeSnapshot = getDevisAuditSnapshotFromDb(id);
  const afterSnapshot = getDevisAuditSnapshotFromDb(id);
  const updatedSnapshot = getDevisAuditSnapshotFromPayload(body, quote);
  const updateChanges = computeDevisAuditChanges(beforeSnapshot, updatedSnapshot);
  if (updateChanges.length > 0) {
    addDevisHistoryEntry(id, 'update', updateChanges);
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
  const devisCustomOptions = db.prepare('SELECT * FROM devis_custom_options WHERE devisId = ? ORDER BY sortOrder, id').all(id);
  const devisResources = db.prepare('SELECT * FROM devis_resources WHERE devisId = ?').all(id);

  const insertRes = db.prepare(`
    INSERT INTO reservations (
      propertyId, clientId, startDate, endDate,
      adults, children, teens, babies,
      singleBeds, doubleBeds, babyBeds,
      checkInTime, checkOutTime, platform,
      totalPrice, touristTaxRate, touristTaxTotal,
      discountPercent, customPrice, finalPrice,
      depositAmount, depositDueDate, depositPaid,
      balanceAmount, balanceDueDate, balancePaid,
      cautionAmount, notes, sourceType
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
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
    devisRow.customPrice,
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
    INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const o of devisOptions) {
    insertOpt.run(reservationId, o.optionId, o.quantity, o.unitPrice, o.billedUnits, o.priceType, o.totalPrice, o.offered ? 1 : 0);
  }

  const insertCustomOpt = db.prepare(`
    INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const o of devisCustomOptions) {
    insertCustomOpt.run(reservationId, o.description, o.amount, Number(o.offered || 0), o.sortOrder || 0);
  }

  // Copy resources
  const insertRsc = db.prepare(`
    INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of devisResources) {
    insertRsc.run(reservationId, r.resourceId, r.quantity, r.unitPrice, r.billedUnits, r.priceType, r.totalPrice, r.offered ? 1 : 0);
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

  // Copy devis history to reservation history
  const devisHistory = db.prepare(`
    SELECT id, eventType, changedFields, createdAt
    FROM devis_history
    WHERE devisId = ?
    ORDER BY createdAt ASC
  `).all(id);

  const insertHistory = db.prepare(`
    INSERT INTO reservation_history (reservationId, eventType, changedFields, createdAt)
    VALUES (?, ?, ?, ?)
  `);

  for (const entry of devisHistory) {
    insertHistory.run(reservationId, entry.eventType, entry.changedFields, entry.createdAt);
  }

  return res.json({ success: true, reservationId });
});

// ─── convert reservation → devis ─────────────────────────────────────────────

router.post('/from-reservation/:reservationId', (req, res) => {
  const reservationId = Number(req.params.reservationId);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
  if (!reservation) return res.status(404).json({ error: 'Réservation introuvable' });

  const resOptions = db.prepare('SELECT * FROM reservation_options WHERE reservationId = ?').all(reservationId);
  const resCustomOptions = db.prepare('SELECT * FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(reservationId);
  const resResources = db.prepare('SELECT * FROM reservation_resources WHERE reservationId = ?').all(reservationId);
  const resNights = db.prepare('SELECT * FROM reservation_nights WHERE reservationId = ?').all(reservationId);

  const devisNumber = db.generateDevisNumber();

  const insertStmt = db.prepare(`
    INSERT INTO devis (
      devisNumber, propertyId, clientId, status,
      startDate, endDate, adults, children, teens, babies,
      singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime,
      platform, totalPrice, touristTaxRate, touristTaxTotal,
      discountPercent, customPrice, finalPrice, depositAmount, depositDueDate,
      balanceAmount, balanceDueDate, cautionAmount, notes
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
    reservation.customPrice,
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
    INSERT INTO devis_options (devisId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const o of resOptions) {
    insertOpt.run(devisId, o.optionId, o.quantity, o.unitPrice, o.billedUnits, o.priceType, o.totalPrice, o.offered ? 1 : 0);
  }

  const insertCustomOption = db.prepare(`
    INSERT INTO devis_custom_options (devisId, description, amount, offered, sortOrder)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const o of resCustomOptions) {
    insertCustomOption.run(devisId, o.description, o.amount, Number(o.offered || 0), o.sortOrder || 0);
  }

  const insertRsc = db.prepare(`
    INSERT INTO devis_resources (devisId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of resResources) {
    insertRsc.run(devisId, r.resourceId, r.quantity, r.unitPrice, r.billedUnits, r.priceType, r.totalPrice, r.offered ? 1 : 0);
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
  doc.on('end', () => {
    const buf = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="devis-${full.devisNumber}.pdf"`);
    res.setHeader('Content-Length', buf.length);
    res.end(buf);
  });
  doc.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
    }
  });

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
    const showOriginal = originalTtc > Number(totalTtc || 0) + 0.009;
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
        .text(settings.companyName, LEFT, ftY, { width: PAGE_W * 0.35, ellipsis: true });
    }
    // Center: SIRET / TVA
    if (legalCenter) {
      doc.fontSize(7.5).fillColor('#888888').font('Helvetica')
        .text(legalCenter, LEFT + PAGE_W * 0.35, ftY, { width: PAGE_W * 0.3, align: 'center' });
    }
    // Right: page X / N
    doc.fontSize(7.5).fillColor('#888888').font('Helvetica')
      .text(`Page ${i + 1} / ${totalPages}`, LEFT + PAGE_W * 0.65, ftY, { width: PAGE_W * 0.35, align: 'right' });
  }

  doc.flushPages();
  doc.end();
});

module.exports = router;
