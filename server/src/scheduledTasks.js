const db = require('./database');

// Import properties routes functions
const propertiesRouter = require('./routes/properties');

let syncInProgress = false;

async function performAutoSync() {
  if (syncInProgress) {
    return;
  }

  syncInProgress = true;
  const startTime = new Date();

  try {
    // Get all active iCal sources
    const sources = db.prepare(`
      SELECT * FROM ical_sources 
      WHERE isActive = 1 
      ORDER BY id
    `).all();

    if (!sources.length) {
      syncInProgress = false;
      return;
    }

    let totalCreated = 0;
    let totalUpdated = 0;
    let totalRemoved = 0;
    let totalErrors = 0;

    // Sync each source
    for (const source of sources) {
      try {
        // Import the syncIcalSource function from routes/properties.js
        // We'll call it via a workaround
        const result = await performIcalSync(source);

        // Update source metadata
        db.prepare(`
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
          source.id
        );

        totalCreated += result.createdCount;
        totalUpdated += result.updatedCount;
        totalRemoved += result.removedCount;

      } catch (error) {
        totalErrors += 1;
        console.error(`[iCal Sync] ❌ Erreur lors de la synchronisation de "${source.name}":`, error.message);

        db.prepare(`
          UPDATE ical_sources
          SET lastSyncAt = datetime('now'),
              lastSyncStatus = 'error',
              lastSyncMessage = ?,
              updatedAt = datetime('now')
          WHERE id = ?
        `).run(String(error.message || 'Erreur de synchronisation iCal'), source.id);
      }
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
  } catch (error) {
    console.error('[iCal Sync] Erreur critique:', error);
  } finally {
    syncInProgress = false;
  }
}

// Copied from routes/properties.js to avoid circular dependency
async function performIcalSync(source) {
  // Helper functions (copied from properties.js)
  function parseIcalDate(rawValue, isDateOnly) {
    if (!rawValue) return null;
    const match = String(rawValue).match(/^(\d{4})(\d{2})(\d{2})/);
    if (!match) return null;
    const [, year, month, day] = match;
    const dateStr = `${year}-${month}-${day}`;
    return dateStr;
  }

  function timeToDecimalHour(timeStr, defaultVal = 0) {
    if (!timeStr || typeof timeStr !== 'string') return defaultVal;
    const [hours, minutes] = timeStr.split(':').map(s => parseInt(s, 10));
    if (isNaN(hours)) return defaultVal;
    return hours + (isNaN(minutes) ? 0 : minutes / 60);
  }

  function unfoldIcsLines(icsText) {
    return icsText.replace(/\r\n /g, '').replace(/\r\n\t/g, '');
  }

  function unescapeIcalText(value) {
    if (!value) return '';
    return String(value)
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\n/g, '\n')
      .replace(/\\\\/g, '\\');
  }

  function parseAdultsFromText(summary, description) {
    const text = `${summary} ${description}`.toLowerCase();
    const match = text.match(/adults?:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  }

  function parseIcsEvents(icsText) {
    const unfolded = unfoldIcsLines(icsText);
    const events = [];
    const eventMatches = unfolded.match(/BEGIN:VEVENT.*?END:VEVENT/gs) || [];

    for (const eventText of eventMatches) {
      const event = {};
      const lines = eventText.split('\n');

      for (const line of lines) {
        if (line.startsWith('UID:')) {
          event.uid = unescapeIcalText(line.slice(4).trim());
        } else if (line.startsWith('SUMMARY:')) {
          event.summary = unescapeIcalText(line.slice(8).trim());
        } else if (line.startsWith('DESCRIPTION:')) {
          event.description = unescapeIcalText(line.slice(12).trim());
        } else if (line.startsWith('DTSTART')) {
          const dateMatch = line.match(/DTSTART(;VALUE=DATE)?:(.+)/);
          if (dateMatch) {
            const isDateOnly = !!dateMatch[1];
            event.startDate = parseIcalDate(dateMatch[2], isDateOnly);
          }
        } else if (line.startsWith('DTEND')) {
          const dateMatch = line.match(/DTEND(;VALUE=DATE)?:(.+)/);
          if (dateMatch) {
            const isDateOnly = !!dateMatch[1];
            event.endDate = parseIcalDate(dateMatch[2], isDateOnly);
          }
        }
      }

      if (event.uid && event.startDate && event.endDate) {
        event.adults = parseAdultsFromText(event.summary || '', event.description || '');
        if (!/unavailable|unavail|blocked|not available/i.test(event.summary || '')) {
          events.push(event);
        }
      }
    }

    return events;
  }

  function buildEventHash(event) {
    return require('crypto')
      .createHash('sha256')
      .update(`${event.uid}|${event.startDate}|${event.endDate}|${event.adults}`)
      .digest('hex');
  }

  // Main sync logic
  const property = db.prepare('SELECT id, defaultCheckIn, defaultCheckOut, defaultCautionAmount FROM properties WHERE id = ?').get(source.propertyId);
  if (!property) {
    throw new Error('Logement introuvable pour cette source iCal.');
  }

  const response = await fetch(source.url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`Impossible de lire le flux iCal (${response.status}).`);
  }
  const icsText = await response.text();
  const events = parseIcsEvents(icsText);

  const getMapping = db.prepare('SELECT reservationId, eventHash FROM ical_import_events WHERE sourceId = ? AND eventUid = ?');
  const listMappings = db.prepare('SELECT eventUid, reservationId FROM ical_import_events WHERE sourceId = ?');
  const deleteMapping = db.prepare('DELETE FROM ical_import_events WHERE sourceId = ? AND eventUid = ?');
  const upsertMapping = db.prepare(`
    INSERT INTO ical_import_events (sourceId, eventUid, reservationId, eventHash, lastSeenAt)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(sourceId, eventUid)
    DO UPDATE SET reservationId=excluded.reservationId, eventHash=excluded.eventHash, lastSeenAt=datetime('now')
  `);

  const getReservationById = db.prepare('SELECT id, sourceType, icalSyncLocked FROM reservations WHERE id = ?');
  const getLockedReservationByDates = db.prepare(`
    SELECT id
    FROM reservations
    WHERE sourceType = 'ical'
      AND sourceIcalSourceId = ?
      AND icalSyncLocked = 1
      AND startDate = ?
      AND endDate = ?
    ORDER BY id DESC
    LIMIT 1
  `);
  const markReservationUid = db.prepare(`
    UPDATE reservations
    SET sourceIcalEventUid = ?, updatedAt = datetime('now')
    WHERE id = ?
  `);
  const deleteReservation = db.prepare('DELETE FROM reservations WHERE id = ?');
  const insertReservation = db.prepare(`
    INSERT INTO reservations (
      propertyId, clientId, startDate, endDate, adults, children, teens, babies,
      singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime,
      platform, totalPrice, discountPercent, finalPrice,
      depositAmount, depositDueDate, depositPaid,
      balanceAmount, balanceDueDate, balancePaid,
      sourceType, sourcePlatformKey, sourceIcalSourceId, sourceIcalEventUid, icalSyncLocked,
      notes, cautionAmount
    ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL, NULL, ?, ?, ?, NULL, 0, NULL, 0, NULL, 0, 0, NULL, 0, 'ical', ?, ?, ?, 0, ?, ?)
  `);

  const updateReservation = db.prepare(`
    UPDATE reservations
    SET startDate = ?, endDate = ?, adults = ?, checkInTime = ?, checkOutTime = ?, platform = ?, notes = ?, updatedAt = datetime('now')
    WHERE id = ?
  `);

  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let lockedCount = 0;
  let removedCount = 0;

  const syncTx = db.transaction((eventList) => {
    const seenUids = new Set(eventList.map((event) => event.uid));

    for (const event of eventList) {
      const eventHash = buildEventHash(event);
      const mapping = getMapping.get(source.id, event.uid);
      const notes = `Import iCal (${source.name})\nUID: ${event.uid}${event.summary ? `\nRésumé: ${event.summary}` : ''}`;

      if (!mapping) {
        // If an imported reservation has been manually locked, try to rebind
        // it when provider-side UID changes but dates are still identical.
        const lockedByDates = getLockedReservationByDates.get(source.id, event.startDate, event.endDate);
        if (lockedByDates) {
          const reservationId = Number(lockedByDates.id);
          markReservationUid.run(event.uid, reservationId);
          upsertMapping.run(source.id, event.uid, reservationId, eventHash);
          lockedCount += 1;
          continue;
        }

        const result = insertReservation.run(
          source.propertyId,
          1, // Default client ID for iCal imports (will be created/updated as needed)
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
        );
        const reservationId = Number(result.lastInsertRowid);
        upsertMapping.run(source.id, event.uid, reservationId, eventHash);
        createdCount += 1;
        continue;
      }

      if (mapping.eventHash === eventHash) {
        unchangedCount += 1;
        upsertMapping.run(source.id, event.uid, mapping.reservationId, eventHash);
        continue;
      }

      const mappedReservation = getReservationById.get(mapping.reservationId);
      if (mappedReservation && String(mappedReservation?.sourceType || '') === 'ical' && Number(mappedReservation?.icalSyncLocked || 0) === 1) {
        upsertMapping.run(source.id, event.uid, mapping.reservationId, eventHash);
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
        notes,
        mapping.reservationId,
      );
      upsertMapping.run(source.id, event.uid, mapping.reservationId, eventHash);
      updatedCount += 1;
    }

    const staleMappings = listMappings.all(source.id).filter((row) => !seenUids.has(row.eventUid));
    staleMappings.forEach((row) => {
      const mappedReservation = getReservationById.get(row.reservationId);
      if (mappedReservation && String(mappedReservation?.sourceType || '') === 'ical' && Number(mappedReservation?.icalSyncLocked || 0) === 1) {
        // Keep manually locked iCal reservations even if the event UID disappeared.
        // Mapping row is removed so a future event can rebind by dates.
        deleteMapping.run(source.id, row.eventUid);
        lockedCount += 1;
        return;
      }

      deleteReservation.run(row.reservationId);
      deleteMapping.run(source.id, row.eventUid);
      removedCount += 1;
    });

    db.prepare(`
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
  };
}

function startScheduledTasks() {
  // Sync iCal sources every 5 minutes (300000 ms)
  const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

  setInterval(() => {
    performAutoSync().catch(err => console.error('[iCal Sync] Erreur non gérée:', err));
  }, SYNC_INTERVAL);

  // Run first sync after 30 seconds to avoid congestion on startup
  setTimeout(() => {
    performAutoSync().catch(err => console.error('[iCal Sync] Erreur lors de la première synchro:', err));
  }, 30000);
}

module.exports = {
  startScheduledTasks,
  performAutoSync,
};
