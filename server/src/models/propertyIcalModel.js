// Property iCal import model — iCal source CRUD + the anti-overbooking sync engine.
// syncSource is the canonical 5-step sync moved VERBATIM from routes/properties.js; never regress it
// (see the iCal anti-overbooking contract). Pure parsing lives in utils/icalParser.

const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');
const { KNOWN_PLATFORM_COLORS, DEFAULT_PLATFORM_COLOR } = require('../constants/platformColors');
const {
  normalizePlatformKey,
  normalizeIcalSummary,
  extractSummaryFromIcalReservationNotes,
  parseGuestName,
  resolveIcalClientIdentity,
  parseIcsEvents,
  buildEventHash,
  shouldSkipIcalReservationUpdate,
  buildIcalCreationHistoryChanges,
} = require('../utils/icalParser');

const SOURCE_COLUMNS = `id, propertyId, name, url, platformKey, platformLabel, platformColor, isActive,
  collectsTouristTax,
  lastSyncAt, lastSyncStatus, lastSyncMessage, lastImportedCount, createdAt, updatedAt`;

function createPropertyIcalModel(database) {
  function getOrCreateIcalClient(guestName, platformLabel) {
    const { firstName, lastName } = resolveIcalClientIdentity(guestName, platformLabel);
    const existing = database.prepare(`
      SELECT id FROM clients
      WHERE lower(firstName) = lower(?) AND lower(lastName) = lower(?)
      ORDER BY id
      LIMIT 1
    `).get(firstName, lastName);
    if (existing) return Number(existing.id);

    const result = database.prepare(`
      INSERT INTO clients (lastName, firstName, notes)
      VALUES (?, ?, ?)
    `).run(lastName, firstName, `${platformLabel}: créé automatiquement lors de l'import iCal`);
    return Number(result.lastInsertRowid);
  }

  function addReservationHistoryEntry(reservationId, eventType, changes) {
    database.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)')
      .run(reservationId, eventType, JSON.stringify(changes || []));
  }

  function resolveSourceInput(body, existing = null) {
    const url = String(body.url ?? existing?.url ?? '').trim();
    const platformKeyInput = String(body.platformKey ?? existing?.platformKey ?? '').trim();
    const platformLabelInput = String(body.platformLabel ?? existing?.platformLabel ?? '').trim();
    const normalizedPlatformKey = normalizePlatformKey(platformKeyInput || platformLabelInput);
    const platformLabel = sentenceCase(platformLabelInput || platformKeyInput || normalizedPlatformKey);

    if (!url || !/^https?:\/\//i.test(url)) return { error: 'URL iCal invalide (http(s) requis).' };
    if (!normalizedPlatformKey) return { error: 'La plateforme est requise.' };

    const knownColor = KNOWN_PLATFORM_COLORS[normalizedPlatformKey];
    const chosenColor = String(body.platformColor || '').trim();
    const platformColor = knownColor || chosenColor || existing?.platformColor || DEFAULT_PLATFORM_COLOR;

    return { url, normalizedPlatformKey, platformLabel, name: platformLabel, platformColor };
  }

  const model = {
    listSources(propertyId) {
      const property = database.prepare('SELECT id FROM properties WHERE id = ?').get(propertyId);
      if (!property) return { error: 'Logement non trouvé', status: 404 };
      const data = database.prepare(`
        SELECT ${SOURCE_COLUMNS}
        FROM ical_sources
        WHERE propertyId = ?
        ORDER BY name COLLATE NOCASE, id DESC
      `).all(propertyId);
      return { data };
    },

    getSource(propertyId, sourceId) {
      return database.prepare('SELECT * FROM ical_sources WHERE id = ? AND propertyId = ?').get(sourceId, propertyId);
    },

    createSource(propertyId, body = {}) {
      const property = database.prepare('SELECT id FROM properties WHERE id = ?').get(propertyId);
      if (!property) return { error: 'Logement non trouvé', status: 404 };
      const input = resolveSourceInput(body);
      if (input.error) return { error: input.error, status: 400 };
      // `collectsTouristTax` defaults to 1 (= platform collects, mirrors legacy behaviour). Explicit false → 0.
      const collectsTouristTax = body.collectsTouristTax === false || body.collectsTouristTax === 0 ? 0 : 1;
      const result = database.prepare(`
        INSERT INTO ical_sources (
          propertyId, name, url, platformKey, platformLabel, platformColor, isActive, collectsTouristTax, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(propertyId, input.name, input.url, input.normalizedPlatformKey, input.platformLabel, input.platformColor, body.isActive === false ? 0 : 1, collectsTouristTax);
      return { data: database.prepare('SELECT * FROM ical_sources WHERE id = ?').get(result.lastInsertRowid) };
    },

    updateSource(propertyId, sourceId, body = {}) {
      const existing = database.prepare('SELECT * FROM ical_sources WHERE id = ? AND propertyId = ?').get(sourceId, propertyId);
      if (!existing) return { error: 'Connexion iCal introuvable.', status: 404 };
      const input = resolveSourceInput(body, existing);
      if (input.error) return { error: input.error, status: 400 };
      const isActive = body.isActive === undefined ? existing.isActive : (body.isActive ? 1 : 0);
      const collectsTouristTax = body.collectsTouristTax === undefined
        ? existing.collectsTouristTax
        : (body.collectsTouristTax ? 1 : 0);
      database.prepare(`
        UPDATE ical_sources
        SET name = ?, url = ?, platformKey = ?, platformLabel = ?, platformColor = ?, isActive = ?,
            collectsTouristTax = ?, updatedAt = datetime('now')
        WHERE id = ? AND propertyId = ?
      `).run(input.name, input.url, input.normalizedPlatformKey, input.platformLabel, input.platformColor, isActive, collectsTouristTax, sourceId, propertyId);
      return { data: database.prepare('SELECT * FROM ical_sources WHERE id = ?').get(sourceId) };
    },

    removeSource(propertyId, sourceId) {
      database.prepare('DELETE FROM ical_sources WHERE id = ? AND propertyId = ?').run(sourceId, propertyId);
      return { data: { ok: true } };
    },

    // The canonical anti-overbooking sync engine — moved verbatim. Do not change the algorithm.
    syncSource(source) {
      return (async () => {
        const property = database.prepare('SELECT id, defaultCheckIn, defaultCheckOut, defaultCautionAmount FROM properties WHERE id = ?').get(source.propertyId);
        if (!property) {
          throw new Error('Logement introuvable pour cette source iCal.');
        }

        const response = await fetch(source.url, { method: 'GET' });
        if (!response.ok) {
          throw new Error(`Impossible de lire le flux iCal (${response.status}).`);
        }
        const icsText = await response.text();
        const events = parseIcsEvents(icsText);

        const getMapping = database.prepare('SELECT reservationId, eventHash FROM ical_import_events WHERE sourceId = ? AND eventUid = ?');
        const getFallbackMapping = database.prepare(`
          SELECT eventUid, reservationId, eventHash
          FROM ical_import_events
          WHERE sourceId = ? AND startDate = ? AND endDate = ? AND summaryNormalized = ?
          ORDER BY lastSeenAt DESC
          LIMIT 1
        `);
        // Cross-platform lookup: an existing reservation imported from ANOTHER source of the same
        // property, matching dates + normalized guest name (excludes the current source — that's the
        // per-source fallback above).
        const getCrossSourceMapping = database.prepare(`
          SELECT iie.eventUid, iie.reservationId, iie.eventHash
          FROM ical_import_events iie
          JOIN ical_sources s ON s.id = iie.sourceId
          WHERE s.propertyId = ? AND iie.sourceId != ? AND iie.startDate = ? AND iie.endDate = ? AND iie.summaryNormalized = ?
          ORDER BY iie.lastSeenAt DESC
          LIMIT 1
        `);
        const listMappings = database.prepare('SELECT eventUid, reservationId FROM ical_import_events WHERE sourceId = ?');
        const deleteMapping = database.prepare('DELETE FROM ical_import_events WHERE sourceId = ? AND eventUid = ?');
        const upsertMapping = database.prepare(`
          INSERT INTO ical_import_events (sourceId, eventUid, reservationId, eventHash, startDate, endDate, summaryNormalized, lastSeenAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(sourceId, eventUid)
          DO UPDATE SET
            reservationId=excluded.reservationId,
            eventHash=excluded.eventHash,
            startDate=excluded.startDate,
            endDate=excluded.endDate,
            summaryNormalized=excluded.summaryNormalized,
            lastSeenAt=datetime('now')
        `);
        const getReservationById = database.prepare('SELECT id, sourceType, icalSyncLocked FROM reservations WHERE id = ?');
        const listSourceReservationsByDates = database.prepare(`
          SELECT id, sourceType, icalSyncLocked, sourceIcalEventUid, notes, icalOriginalSummary
          FROM reservations
          WHERE sourceType = 'ical'
            AND sourceIcalSourceId = ?
            AND startDate = ?
            AND endDate = ?
          ORDER BY id DESC
        `);
        const markReservationUid = database.prepare(`
          UPDATE reservations
          SET sourceIcalEventUid = ?, updatedAt = datetime('now')
          WHERE id = ?
        `);
        const deleteReservation = database.prepare('DELETE FROM reservations WHERE id = ?');
        const insertReservation = database.prepare(`
          INSERT INTO reservations (
            propertyId, clientId, startDate, endDate, adults, children, teens, babies,
            singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime,
            platform, totalPrice, discountPercent, finalPrice,
            depositAmount, depositDueDate, depositPaid,
            balanceAmount, balanceDueDate, balancePaid,
            sourceType, sourcePlatformKey, sourceIcalSourceId, sourceIcalEventUid, icalSyncLocked,
            notes, cautionAmount, icalOriginalSummary
          ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL, NULL, ?, ?, ?, 0, 0, 0, 0, NULL, 0, 0, NULL, 0, 'ical', ?, ?, ?, 0, ?, ?, ?)
        `);
        const updateReservation = database.prepare(`
          UPDATE reservations
          SET startDate = ?, endDate = ?, adults = ?, checkInTime = ?, checkOutTime = ?, platform = ?, sourceIcalEventUid = ?, notes = ?, updatedAt = datetime('now')
          WHERE id = ?
        `);

        let createdCount = 0;
        let updatedCount = 0;
        let unchangedCount = 0;
        let lockedCount = 0;
        let removedCount = 0;

        const syncTx = database.transaction((eventList) => {
          const seenUids = new Set(eventList.map((event) => event.uid));

          for (const event of eventList) {
            const eventHash = buildEventHash(event);
            const summaryNormalized = normalizeIcalSummary(event.summary);
            let mapping = getMapping.get(source.id, event.uid);
            let previousUid = event.uid;

            if (!mapping && summaryNormalized) {
              const fallbackMapping = getFallbackMapping.get(source.id, event.startDate, event.endDate, summaryNormalized);
              if (fallbackMapping) {
                mapping = fallbackMapping;
                previousUid = String(fallbackMapping.eventUid || '');
              }
            }

            if (!mapping && summaryNormalized) {
              const legacyCandidate = listSourceReservationsByDates
                .all(source.id, event.startDate, event.endDate)
                // Prefer the authoritative stored original name; fall back to the legacy notes parse for
                // pre-column rows. Robust even if the user renamed the client on the reservation.
                .find((row) => normalizeIcalSummary(row.icalOriginalSummary || extractSummaryFromIcalReservationNotes(row.notes)) === summaryNormalized);
              if (legacyCandidate) {
                mapping = { reservationId: Number(legacyCandidate.id), eventHash: null };
                previousUid = String(legacyCandidate.sourceIcalEventUid || '');
              }
            }

            // Cross-platform de-dup: the SAME booking can appear in several platforms' feeds (same dates +
            // same guest name, different source + UID). Map it to the existing reservation from the other
            // source instead of creating a duplicate. previousUid stays this event's uid so the other
            // source's mapping is NOT removed — both sources then reference the one reservation.
            if (!mapping && summaryNormalized) {
              const crossSource = getCrossSourceMapping.get(source.propertyId, source.id, event.startDate, event.endDate, summaryNormalized);
              if (crossSource) {
                mapping = { reservationId: Number(crossSource.reservationId), eventHash: crossSource.eventHash };
              }
            }

            const notes = `Import iCal (${source.name})\nUID: ${event.uid}${event.summary ? `\nRésumé: ${event.summary}` : ''}`;

            if (!mapping) {
              // Resolve the iCal client only where it is actually persisted (insert branches);
              // updates never relink clientId, so resolving it elsewhere would orphan clients.
              const clientId = getOrCreateIcalClient(parseGuestName(event.summary, event.description), source.platformLabel || source.name);
              const result = insertReservation.run(
                source.propertyId,
                clientId,
                event.startDate,
                event.endDate,
                event.adults,
                property.defaultCheckIn || '15:00',
                property.defaultCheckOut || '10:00',
                source.platformKey,
                source.platformKey,
                source.id,
                event.uid,
                notes,
                property.defaultCautionAmount || 0,
                event.summary,
              );
              const reservationId = Number(result.lastInsertRowid);
              upsertMapping.run(source.id, event.uid, reservationId, eventHash, event.startDate, event.endDate, summaryNormalized);
              addReservationHistoryEntry(reservationId, 'create', buildIcalCreationHistoryChanges(source, event.uid));
              createdCount += 1;
              continue;
            }

            const mappedReservation = getReservationById.get(mapping.reservationId);
            if (!mappedReservation) {
              const clientId = getOrCreateIcalClient(parseGuestName(event.summary, event.description), source.platformLabel || source.name);
              const result = insertReservation.run(
                source.propertyId,
                clientId,
                event.startDate,
                event.endDate,
                event.adults,
                property.defaultCheckIn || '15:00',
                property.defaultCheckOut || '10:00',
                source.platformKey,
                source.platformKey,
                source.id,
                event.uid,
                notes,
                property.defaultCautionAmount || 0,
                event.summary,
              );
              const reservationId = Number(result.lastInsertRowid);
              upsertMapping.run(source.id, event.uid, reservationId, eventHash, event.startDate, event.endDate, summaryNormalized);
              if (previousUid && previousUid !== event.uid) {
                deleteMapping.run(source.id, previousUid);
              }
              addReservationHistoryEntry(reservationId, 'create', buildIcalCreationHistoryChanges(source, event.uid));
              createdCount += 1;
              continue;
            }

            markReservationUid.run(event.uid, mapping.reservationId);
            if (previousUid && previousUid !== event.uid) {
              deleteMapping.run(source.id, previousUid);
            }

            if (mapping.eventHash === eventHash) {
              upsertMapping.run(source.id, event.uid, mapping.reservationId, eventHash, event.startDate, event.endDate, summaryNormalized);
              unchangedCount += 1;
              continue;
            }

            if (shouldSkipIcalReservationUpdate(mappedReservation)) {
              upsertMapping.run(source.id, event.uid, mapping.reservationId, eventHash, event.startDate, event.endDate, summaryNormalized);
              lockedCount += 1;
              continue;
            }

            updateReservation.run(
              event.startDate,
              event.endDate,
              event.adults,
              property.defaultCheckIn || '15:00',
              property.defaultCheckOut || '10:00',
              source.platformKey,
              event.uid,
              notes,
              mapping.reservationId,
            );
            upsertMapping.run(source.id, event.uid, mapping.reservationId, eventHash, event.startDate, event.endDate, summaryNormalized);
            updatedCount += 1;
          }

          // Remove reservations that were previously imported from this source
          // but are no longer present in the incoming iCal feed (or now filtered out).
          const staleMappings = listMappings
            .all(source.id)
            .filter((row) => !seenUids.has(row.eventUid));
          const countMappingsForReservation = database.prepare('SELECT COUNT(*) c FROM ical_import_events WHERE reservationId = ?');
          staleMappings.forEach((row) => {
            // Drop this source's mapping; only delete the reservation if no OTHER source's mapping still
            // references it (a cross-platform-shared booking survives until every feed drops it).
            deleteMapping.run(source.id, row.eventUid);
            if (countMappingsForReservation.get(row.reservationId).c === 0) {
              deleteReservation.run(row.reservationId);
              removedCount += 1;
            }
          });

          // Cleanup orphan clients created by iCal imports.
          database.prepare(`
            DELETE FROM clients
            WHERE NOT EXISTS (SELECT 1 FROM reservations WHERE reservations.clientId = clients.id)
              AND notes LIKE 'iCal {%'
          `).run();
        });

        syncTx(events);

        return {
          scannedEvents: events.length,
          createdCount,
          updatedCount,
          unchangedCount,
          lockedCount,
          removedCount,
          rawIcal: icsText,
          parsedEvents: events,
        };
      })();
    },

    // Sync + persist the source status row (DRYs the formerly triplicated UPDATE block:
    // the /sync route, /sync-all route, and scheduledTasks.performAutoSync all use this).
    async syncSourceAndRecord(source) {
      try {
        const result = await model.syncSource(source);
        database.prepare(`
          UPDATE ical_sources
          SET lastSyncAt = datetime('now'),
              lastSyncStatus = 'success',
              lastSyncMessage = ?,
              lastImportedCount = ?,
              updatedAt = datetime('now')
          WHERE id = ?
        `).run(
          `${result.createdCount} créé(s), ${result.updatedCount} mis à jour, ${result.lockedCount} verrouillé(s), ${result.removedCount} supprimé(s), ${result.unchangedCount} inchangé(s)`,
          result.createdCount + result.updatedCount,
          source.id,
        );
        return result;
      } catch (error) {
        database.prepare(`
          UPDATE ical_sources
          SET lastSyncAt = datetime('now'),
              lastSyncStatus = 'error',
              lastSyncMessage = ?,
              updatedAt = datetime('now')
          WHERE id = ?
        `).run(String(error.message || 'Erreur de synchronisation iCal'), source.id);
        throw error;
      }
    },

    async syncOne(propertyId, sourceId) {
      const source = model.getSource(propertyId, sourceId);
      if (!source) return { error: 'Connexion iCal introuvable.', status: 404 };
      try {
        return { data: await model.syncSourceAndRecord(source) };
      } catch (error) {
        return { error: String(error.message || 'Erreur de synchronisation iCal'), status: 400 };
      }
    },

    async syncAllForProperty(propertyId) {
      const sources = database.prepare('SELECT * FROM ical_sources WHERE propertyId = ? AND isActive = 1 ORDER BY id').all(propertyId);
      if (!sources.length) return { ok: true, results: [] };

      const results = [];
      for (const source of sources) {
        try {
          const result = await model.syncSourceAndRecord(source);
          results.push({ sourceId: source.id, sourceName: source.name, ok: true, ...result });
        } catch (error) {
          results.push({ sourceId: source.id, sourceName: source.name, ok: false, error: String(error.message || 'Erreur de synchronisation iCal') });
        }
      }
      return { ok: true, results };
    },
  };

  return model;
}

const defaultModel = createPropertyIcalModel(db);
defaultModel.buildModel = createPropertyIcalModel;

module.exports = defaultModel;
