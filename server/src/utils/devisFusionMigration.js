// One-time data migration: fold the legacy `devis_*` tables into the `reservations` family.
// Each devis becomes a `reservations` row with kind='devis' (preserving devisNumber / devisStatus /
// validUntil / convertedReservationId); its options/custom options/resources/nights/history move into
// the matching reservation_* tables. Insert + verify + drop run in ONE transaction → either fully
// migrated (and devis_* dropped) or fully rolled back. Idempotent: after success the devis tables are
// gone, so a re-run is a no-op.
//
// PREREQUISITE: the reservations table must already have the new columns
// (kind, devisNumber, devisStatus, validUntil, convertedReservationId).

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name);
}

// The legacy devis_* tables, children first so DROP order is FK-safe.
const LEGACY_DEVIS_TABLES = [
  'devis_options', 'devis_custom_options', 'devis_resources', 'devis_nights', 'devis_history', 'devis',
];

function countRows(db, name) {
  if (!tableExists(db, name)) return 0;
  return db.prepare(`SELECT COUNT(*) c FROM ${name}`).get().c;
}

/**
 * Decide, at boot, what to do with the legacy devis_* schema — robust for prod, not just the dev symptom.
 * The fusion (`migrateDevisIntoReservations`) is atomic, so a healthy DB is only ever in one of:
 *   - no `devis` table        → 'noTable' (fresh install or fusion already completed) → do nothing.
 *   - devis rows, none fused   → 'migrate' (genuine one-time fusion; back it up first).
 *   - all legacy tables EMPTY  → 'dropLeftover' (rows already fused but tables never dropped — a
 *                                pre-atomic-migration artefact; drop the empty husks, NO backup needed).
 *   - anything else            → 'skipAmbiguous' (legacy rows AND fused rows coexist) → leave untouched
 *                                for a manual check; never auto-drop data, never re-backup on every boot.
 * Returns { action, pendingDevis, alreadyFused, legacyRowTotal }.
 */
function assessDevisFusion(db) {
  if (!tableExists(db, 'devis')) return { action: 'noTable', pendingDevis: 0, alreadyFused: 0, legacyRowTotal: 0 };
  const pendingDevis = countRows(db, 'devis');
  const alreadyFused = db.prepare("SELECT COUNT(*) c FROM reservations WHERE kind = 'devis'").get().c;
  const legacyRowTotal = LEGACY_DEVIS_TABLES.reduce((sum, t) => sum + countRows(db, t), 0);

  if (alreadyFused === 0 && pendingDevis > 0) return { action: 'migrate', pendingDevis, alreadyFused, legacyRowTotal };
  if (legacyRowTotal === 0) return { action: 'dropLeftover', pendingDevis, alreadyFused, legacyRowTotal };
  return { action: 'skipAmbiguous', pendingDevis, alreadyFused, legacyRowTotal };
}

// Drop the (empty) legacy devis_* tables in one transaction. Only call when legacyRowTotal === 0.
function dropLegacyDevisTables(db) {
  const run = db.transaction(() => {
    for (const t of LEGACY_DEVIS_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
  });
  run();
}

function migrateDevisIntoReservations(db) {
  if (!tableExists(db, 'devis')) return { skipped: true, reason: 'no devis table' };

  // Partial-state guard: legacy table present AND fused rows already exist → don't double-insert.
  const existingFused = db.prepare("SELECT COUNT(*) c FROM reservations WHERE kind = 'devis'").get().c;
  if (existingFused > 0) {
    return { skipped: true, reason: 'devis rows already fused; manual check needed' };
  }

  const devisRows = db.prepare('SELECT * FROM devis').all();

  const insertReservation = db.prepare(`
    INSERT INTO reservations (
      kind, devisNumber, devisStatus, validUntil, convertedReservationId,
      propertyId, clientId, startDate, endDate, adults, children, teens, babies,
      singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime, platform,
      totalPrice, touristTaxRate, touristTaxTotal, discountPercent, customPrice, finalPrice,
      depositAmount, depositDueDate, balanceAmount, balanceDueDate, cautionAmount, notes,
      createdAt, updatedAt
    ) VALUES (
      'devis', @devisNumber, @status, @validUntil, @convertedReservationId,
      @propertyId, @clientId, @startDate, @endDate, @adults, @children, @teens, @babies,
      @singleBeds, @doubleBeds, @babyBeds, @checkInTime, @checkOutTime, @platform,
      @totalPrice, @touristTaxRate, @touristTaxTotal, @discountPercent, @customPrice, @finalPrice,
      @depositAmount, @depositDueDate, @balanceAmount, @balanceDueDate, @cautionAmount, @notes,
      @createdAt, @updatedAt
    )
  `);
  const insOpt = db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insCustom = db.prepare('INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insRes = db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insNight = db.prepare('INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, ?, ?, ?)');
  const insHist = db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields, createdAt) VALUES (?, ?, ?, ?)');

  const selOpt = db.prepare('SELECT * FROM devis_options WHERE devisId = ?');
  const selCustom = db.prepare('SELECT * FROM devis_custom_options WHERE devisId = ?');
  const selRes = db.prepare('SELECT * FROM devis_resources WHERE devisId = ?');
  const selNight = db.prepare('SELECT * FROM devis_nights WHERE devisId = ?');
  const selHist = db.prepare('SELECT * FROM devis_history WHERE devisId = ?');

  const counts = { devis: devisRows.length, options: 0, customOptions: 0, resources: 0, nights: 0, history: 0 };

  const run = db.transaction(() => {
    for (const d of devisRows) {
      const res = insertReservation.run({
        devisNumber: d.devisNumber,
        status: d.status,
        validUntil: d.validUntil ?? null,
        convertedReservationId: d.convertedReservationId ?? null,
        propertyId: d.propertyId,
        clientId: d.clientId,
        startDate: d.startDate,
        endDate: d.endDate,
        adults: d.adults,
        children: d.children,
        teens: d.teens,
        babies: d.babies,
        singleBeds: d.singleBeds ?? null,
        doubleBeds: d.doubleBeds ?? null,
        babyBeds: d.babyBeds ?? null,
        checkInTime: d.checkInTime,
        checkOutTime: d.checkOutTime,
        platform: d.platform,
        totalPrice: d.totalPrice,
        touristTaxRate: d.touristTaxRate,
        touristTaxTotal: d.touristTaxTotal,
        discountPercent: d.discountPercent,
        customPrice: d.customPrice ?? null,
        finalPrice: d.finalPrice,
        depositAmount: d.depositAmount,
        depositDueDate: d.depositDueDate ?? null,
        balanceAmount: d.balanceAmount,
        balanceDueDate: d.balanceDueDate ?? null,
        cautionAmount: d.cautionAmount,
        notes: d.notes ?? '',
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      });
      const newId = Number(res.lastInsertRowid);

      for (const o of selOpt.all(d.id)) { insOpt.run(newId, o.optionId, o.quantity, o.unitPrice, o.billedUnits, o.priceType, o.totalPrice, o.offered); counts.options += 1; }
      for (const c of selCustom.all(d.id)) { insCustom.run(newId, c.description, c.amount, c.offered, c.sortOrder, c.createdAt, c.updatedAt); counts.customOptions += 1; }
      for (const r of selRes.all(d.id)) { insRes.run(newId, r.resourceId, r.quantity, r.unitPrice, r.billedUnits, r.priceType, r.totalPrice, r.offered); counts.resources += 1; }
      for (const n of selNight.all(d.id)) { insNight.run(newId, n.date, n.seasonLabel, n.pricingMode, n.price); counts.nights += 1; }
      for (const h of selHist.all(d.id)) { insHist.run(newId, h.eventType, h.changedFields, h.createdAt); counts.history += 1; }
    }

    // Verify inside the transaction so any mismatch rolls everything back.
    const fused = db.prepare("SELECT COUNT(*) c FROM reservations WHERE kind = 'devis'").get().c;
    if (fused !== devisRows.length) {
      throw new Error(`devis fusion mismatch: expected ${devisRows.length} fused rows, got ${fused}`);
    }

    db.exec(`
      DROP TABLE IF EXISTS devis_options;
      DROP TABLE IF EXISTS devis_custom_options;
      DROP TABLE IF EXISTS devis_resources;
      DROP TABLE IF EXISTS devis_nights;
      DROP TABLE IF EXISTS devis_history;
      DROP TABLE IF EXISTS devis;
    `);
  });

  run();
  return { skipped: false, ...counts };
}

module.exports = { migrateDevisIntoReservations, tableExists, assessDevisFusion, dropLegacyDevisTables, LEGACY_DEVIS_TABLES };
