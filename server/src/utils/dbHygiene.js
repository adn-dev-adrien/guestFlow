/**
 * DB hygiene — cross-cutting indexes + UNIQUE constraints + legacy column drop.
 *
 * Extracted from database.js so it can be tested in isolation against an
 * in-memory database. See specs/db-hygiene-quick-wins.md (Bloc 0).
 *
 * Exports:
 *   FK_INDEXES        — list of [name, table, columns] tuples (regular indexes)
 *   UNIQUE_INDEXES    — list of { name, table, columns: [...], friendly } (with duplicate pre-check)
 *   applyHygiene(db, opts?) — runs the pass; opts.logger defaults to console
 */

const FK_INDEXES = [
  // pricing_rules / documents / property_options
  ['idx_pricing_rules_propertyId', 'pricing_rules', 'propertyId'],
  ['idx_documents_propertyId', 'documents', 'propertyId'],
  ['idx_property_options_propertyId', 'property_options', 'propertyId'],
  ['idx_property_options_optionId', 'property_options', 'optionId'],
  // reservations + sibling tables
  ['idx_reservations_propertyId', 'reservations', 'propertyId'],
  ['idx_reservations_clientId', 'reservations', 'clientId'],
  ['idx_reservations_startDate', 'reservations', 'startDate'],
  ['idx_reservation_options_reservationId', 'reservation_options', 'reservationId'],
  ['idx_reservation_options_optionId', 'reservation_options', 'optionId'],
  ['idx_reservation_custom_options_reservationId', 'reservation_custom_options', 'reservationId'],
  ['idx_reservation_resources_reservationId', 'reservation_resources', 'reservationId'],
  ['idx_reservation_resources_resourceId', 'reservation_resources', 'resourceId'],
  ['idx_reservation_nights_reservationId', 'reservation_nights', 'reservationId'],
  ['idx_reservation_history_reservationId', 'reservation_history', 'reservationId'],
  // resource_bookings
  ['idx_resource_bookings_resourceId', 'resource_bookings', 'resourceId'],
  ['idx_resource_bookings_reservationId', 'resource_bookings', 'reservationId'],
  ['idx_resource_bookings_propertyId', 'resource_bookings', 'propertyId'],
  ['idx_resource_bookings_date', 'resource_bookings', 'date'],
  // devis + sibling tables
  ['idx_devis_propertyId', 'devis', 'propertyId'],
  ['idx_devis_clientId', 'devis', 'clientId'],
  ['idx_devis_status', 'devis', 'status'],
  ['idx_devis_options_devisId', 'devis_options', 'devisId'],
  ['idx_devis_options_optionId', 'devis_options', 'optionId'],
  ['idx_devis_custom_options_devisId', 'devis_custom_options', 'devisId'],
  ['idx_devis_resources_devisId', 'devis_resources', 'devisId'],
  ['idx_devis_resources_resourceId', 'devis_resources', 'resourceId'],
  ['idx_devis_nights_devisId', 'devis_nights', 'devisId'],
  ['idx_devis_history_devisId', 'devis_history', 'devisId'],
  // ical / calendar_notes / ical_tokens
  ['idx_ical_sources_propertyId', 'ical_sources', 'propertyId'],
  ['idx_ical_tokens_propertyId', 'ical_tokens', 'propertyId'],
  ['idx_calendar_notes_propertyId_date', 'calendar_notes', 'propertyId, date'],
  // iCal anti-overbooking lookups (spec §1.1)
  ['idx_reservations_ical_source', 'reservations', 'sourceIcalSourceId, sourceIcalEventUid'],
  ['idx_ical_import_events_reservationId', 'ical_import_events', 'reservationId'],
  // establishment_closures overlap lookups (spec establishment-closures §5)
  ['idx_establishment_closures_propertyId_dates', 'establishment_closures', 'propertyId, startDate, endDate'],
  // school_holidays auto-sync upsert lookup (spec school-holidays §5)
  ['idx_school_holidays_externalRef', 'school_holidays', 'externalRef'],
];

const UNIQUE_INDEXES = [
  {
    name: 'uniq_resource_bookings_slot',
    table: 'resource_bookings',
    columns: ['resourceId', 'date', 'startTime', 'endTime'],
    friendly: 'resource_bookings (créneaux)',
  },
  {
    name: 'uniq_ical_sources_property_platform',
    table: 'ical_sources',
    columns: ['propertyId', 'platformKey'],
    friendly: 'ical_sources (plateformes par logement)',
  },
];

function tableExists(db, table) {
  return Boolean(db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(table));
}

function applyHygiene(db, opts = {}) {
  const logger = opts.logger || console;

  // 1) Plain (non-unique) indexes — safe and additive.
  for (const [name, table, cols] of FK_INDEXES) {
    if (!tableExists(db, table)) continue;
    try {
      db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${table}(${cols})`);
    } catch (err) {
      logger.warn(`[Hygiene] Création de l'index ${name} ignorée : ${err.message}`);
    }
  }

  // 2) UNIQUE indexes with duplicate pre-check.
  for (const { name, table, columns, friendly } of UNIQUE_INDEXES) {
    if (!tableExists(db, table)) continue;
    const cols = columns.join(', ');
    try {
      const dup = db.prepare(`
        SELECT ${cols}, COUNT(*) AS dupCount FROM ${table}
        GROUP BY ${cols} HAVING dupCount > 1 LIMIT 1
      `).get();
      if (dup) {
        logger.warn(`[Hygiene] Doublons détectés dans ${friendly} — index unique non créé. Nettoyez les données manuellement puis redémarrez.`);
        continue;
      }
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${name} ON ${table}(${cols})`);
    } catch (err) {
      logger.warn(`[Hygiene] Création de l'index unique ${name} ignorée : ${err.message}`);
    }
  }

  // 3) Drop the legacy resources.propertyId column (consolidated on propertyIds JSON).
  //
  // SQLite refuses to drop a column that is itself part of a FOREIGN KEY definition
  // (the original CREATE TABLE for `resources` has `FOREIGN KEY (propertyId) REFERENCES
  // properties(id)`). A full table rebuild (recreate without the column, copy rows,
  // drop, rename) is overkill for a quick-wins pass — and the application code no
  // longer reads or writes this column anyway (all callers use `propertyIds` JSON).
  //
  // So: try the direct drop (works on schemas without the FK definition — e.g. tests),
  // and if SQLite refuses, log an info-level note explaining the situation.
  try {
    if (tableExists(db, 'resources')) {
      const resCols = db.prepare('PRAGMA table_info(resources)').all().map((c) => c.name);
      if (resCols.includes('propertyId')) {
        try {
          db.exec('ALTER TABLE resources DROP COLUMN propertyId');
          logger.log('[Hygiene] Colonne resources.propertyId supprimée (utiliser propertyIds JSON à la place).');
        } catch (dropErr) {
          logger.log('[Hygiene] resources.propertyId conservée (FK SQLite empêche le DROP). Sans impact — l\'application utilise désormais uniquement propertyIds JSON.');
        }
      }
    }
  } catch (err) {
    logger.warn(`[Hygiene] Échec inattendu lors du check resources.propertyId : ${err.message}`);
  }

  logger.log('[Hygiene] Index et contraintes appliqués.');
}

module.exports = { applyHygiene, FK_INDEXES, UNIQUE_INDEXES };
