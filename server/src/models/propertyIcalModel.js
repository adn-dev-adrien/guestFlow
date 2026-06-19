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
  isLockedDateDrift,
  buildIcalCreationHistoryChanges,
} = require('../utils/icalParser');
const icalDateDriftModel = require('./icalDateDriftModel');
const platformsModel = require('./platformsModel');
const { formatPlatformName } = require('../utils/platformNameFormat');
const { getTodayIsoDate } = require('../utils/reservationHelpers');
const { assignReservationNumberIfMissing } = require('../utils/reservationNumber');
const icalCancellationModel = require('./icalCancellationModel');
const notificationService = require('../utils/notificationService');
// Establishment closures (2026-06-06): every iCal event is checked against the
// closure table BEFORE touching the local reservations table. Until this guard
// landed, the iCal sync called `INSERT INTO reservations` directly — bypassing
// `validateAvailability` (which only runs on the HTTP API path) — so a remote
// platform could silently override an operator-declared closure with a new
// reservation. The guard treats closure-overlapping events the same way the
// `isUnavailableIcalEvent` filter treats "Closed Period" entries: skip the event,
// leave the local DB alone, count it in the sync result for visibility.
const establishmentClosuresModel = require('./establishmentClosuresModel');

const SOURCE_COLUMNS = `id, propertyId, name, url, platformKey, platformLabel, platformColor, isActive,
  collectsTouristTax,
  lastSyncAt, lastSyncStatus, lastSyncMessage, lastImportedCount, createdAt, updatedAt`;

function createPropertyIcalModel(database) {
  // Bind the drift + cancellation models to the SAME database instance so prod and unit
  // tests share one consistent SQLite handle (the default exports are bound to the
  // production DB; tests build a fresh property-ical model on `:memory:`, and they need
  // matching companion models).
  const driftModel = icalDateDriftModel.buildModel(database);
  const cancellationModel = icalCancellationModel.buildModel(database);
  // 2026-06-06 — same DB-binding rationale for the closure model: tests build a fresh
  // property-ical model on :memory:, and the closure guard must consult THAT in-memory
  // closures table, not the prod one. Default export of establishmentClosuresModel is
  // bound to the prod DB; `.create(database)` returns a fresh instance bound to ours.
  const closuresModel = establishmentClosuresModel.create(database);

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
    // specs/normalize-platform-names.md §3.2 — `platformLabel` lands in `ical_sources.platformLabel`
    // and is propagated to `platforms.name` via the upsert hook below + `reservations.platform`
    // on every iCal-imported booking. Normalize to UpperCamelCase here so the entire chain sees
    // the canonical form (and the case-different duplicates that surfaced on the 2026-06-04
    // prod-copy DB don't reappear).
    const platformLabelRaw = sentenceCase(platformLabelInput || platformKeyInput || normalizedPlatformKey);
    const platformLabel = formatPlatformName(platformLabelRaw) || platformLabelRaw;

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
      // accounting-platform-commission-and-no-deposit.md §3.1 rule 2: surface this platform on
      // the dedicated config page right away (idempotent INSERT OR IGNORE).
      platformsModel.upsertByName(input.platformLabel);
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
      // §3.1 rule 2 — if the user renamed the platform, the previous row stays as a "ghost"
      // (see spec Q8); the new name lands on the page on next reload.
      platformsModel.upsertByName(input.platformLabel);
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
        // specs/ical-summary-fallback-cross-uid.md — step 3.5 in the matching cascade.
        // When the platform re-issues a NEW UID alongside a date change (Abracadaroom
        // does this on every reschedule), every prior fallback fails (they all key on
        // the NEW dates) but the SUMMARY stays stable. We return every candidate so the
        // caller can (a) discard active mappings (= UIDs still in the current feed:
        // those would be a false-positive remap of two unrelated bookings sharing a
        // generic summary like "Closed Period") and (b) enforce a uniqueness gate over
        // the remaining truly-stale candidates.
        const listSameSourceMappingsBySummary = database.prepare(`
          SELECT eventUid, reservationId, eventHash
            FROM ical_import_events
           WHERE sourceId = ? AND summaryNormalized = ?
           ORDER BY datetime(lastSeenAt) DESC
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
        // startDate/endDate are needed so the locked date-drift detector
        // (isLockedDateDrift / icalDateDriftModel) can compare the persisted dates against the
        // ones proposed by the source feed — see specs/ical-sync-override-locked-dates.md §3.
        const getReservationById = database.prepare('SELECT id, sourceType, icalSyncLocked, startDate, endDate FROM reservations WHERE id = ?');
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
        // Apply the property's default options to a freshly-created iCal reservation so a bed-linen
        // (or any) default option appears immediately on the booking, marked `offered` per the
        // property setting (specs/bed-config-in-linen-card.md §10 follow-up). Pricing is left at 0 —
        // iCal reservations stay unpriced (the platform handles payment); when the operator opens
        // and saves one, the pricing engine recomputes every option from optionId + quantity.
        // Guarded: minimal test schemas may lack property_option_defaults / reservation_options, in
        // which case this is a no-op (prod/dev DBs always have them).
        let applyPropertyOptionDefaults = () => {};
        try {
          const listPropertyOptionDefaults = database.prepare(`
            SELECT d.optionId, d.offered, o.priceType
            FROM property_option_defaults d
            JOIN options o ON o.id = d.optionId
            WHERE d.propertyId = ?
          `);
          const insertReservationOption = database.prepare(`
            INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
            VALUES (?, ?, 1, 0, 0, ?, 0, ?)
          `);
          applyPropertyOptionDefaults = (reservationId, propertyId) => {
            for (const d of listPropertyOptionDefaults.all(propertyId)) {
              insertReservationOption.run(reservationId, d.optionId, d.priceType || 'per_stay', d.offered ? 1 : 0);
            }
          };
        } catch { /* minimal test schema without these tables — skip defaults */ }
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
        let skippedClosureCount = 0;
        // IDs of GENUINELY-new reservations created in THIS sync run — drives the per-reservation
        // email notification post-commit (specs/site-booking-notifications.md §3 rule 7). Not a
        // "created today" query, so a re-sync of already-known rows never re-notifies.
        const createdReservationIds = [];

        const syncTx = database.transaction((eventList) => {
          const seenUids = new Set(eventList.map((event) => event.uid));

          // Auto-resolve any pending cancellation alerts whose UID is back in the feed —
          // the platform un-cancelled the booking, so the alert is moot
          // (specs/ical-cancellation-approval.md §3 rule 4).
          cancellationModel.resolveOnReappearance(
            eventList.map((event) => ({ sourceId: source.id, eventUid: event.uid })),
          );

          for (const event of eventList) {
            // 2026-06-06 — Closure guard. An operator-declared establishment closure on
            // this property's dates MUST win over any incoming iCal event. Without this
            // check, the sync would happily INSERT the reservation (the prepared
            // statement above bypasses `validateAvailability`), and the operator would
            // discover the override only by reading the planning. Same skip-style as
            // `isUnavailableIcalEvent`: don't insert, don't touch any existing mapping,
            // don't raise an alert — the closure was explicit, the operator already
            // knows about it.
            const coveringClosure = closuresModel.findCoveringClosure(
              source.propertyId,
              event.startDate,
              event.endDate,
            );
            if (coveringClosure) {
              skippedClosureCount += 1;
              continue;
            }

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

            // Step 3.5 — re-claim a moved booking when the platform re-issued its UID
            // (specs/ical-summary-fallback-cross-uid.md §3 rules 1-3). Every prior fallback
            // keyed on the NEW dates; this one keys on the stable summary. Two guards make
            // the heuristic safe:
            //   (a) we only consider candidates whose UID is NOT in the current feed —
            //       those are about to become stale, i.e. they map to a booking that has
            //       genuinely disappeared. An active candidate sharing a generic summary
            //       with the new event (e.g. two distinct "Closed Period" entries in the
            //       same feed) would otherwise be silently rewired.
            //   (b) uniqueness: exactly ONE stale candidate. With multiple stale matches
            //       the heuristic cannot tell which one moved → we fall through to step 4
            //       + INSERT and let the cancellation alert flow surface the orphans for
            //       manual arbitration.
            if (!mapping && summaryNormalized) {
              const sameSummaryCandidates = listSameSourceMappingsBySummary.all(source.id, summaryNormalized);
              const staleCandidates = sameSummaryCandidates.filter((c) => !seenUids.has(c.eventUid));
              if (staleCandidates.length === 1) {
                const candidate = staleCandidates[0];
                mapping = { reservationId: Number(candidate.reservationId), eventHash: candidate.eventHash };
                previousUid = String(candidate.eventUid || '');
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
              applyPropertyOptionDefaults(reservationId, source.propertyId);
              assignReservationNumberIfMissing(database, reservationId);
              upsertMapping.run(source.id, event.uid, reservationId, eventHash, event.startDate, event.endDate, summaryNormalized);
              addReservationHistoryEntry(reservationId, 'create', buildIcalCreationHistoryChanges(source, event.uid));
              createdCount += 1;
              createdReservationIds.push(reservationId);
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
              applyPropertyOptionDefaults(reservationId, source.propertyId);
              assignReservationNumberIfMissing(database, reservationId);
              upsertMapping.run(source.id, event.uid, reservationId, eventHash, event.startDate, event.endDate, summaryNormalized);
              if (previousUid && previousUid !== event.uid) {
                deleteMapping.run(source.id, previousUid);
              }
              addReservationHistoryEntry(reservationId, 'create', buildIcalCreationHistoryChanges(source, event.uid));
              createdCount += 1;
              createdReservationIds.push(reservationId);
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
              // Locked: the reservation is NOT touched. If the source proposed new dates we
              // record a pending drift so the user can approve / reject from the Dashboard
              // (specs/ical-sync-override-locked-dates.md §3 rules 1-3). Other locked diffs
              // (summary / adults only) are skipped silently as before.
              if (isLockedDateDrift(mappedReservation, event)) {
                driftModel.recordPending({
                  reservationId: mapping.reservationId,
                  previousStartDate: mappedReservation.startDate,
                  previousEndDate: mappedReservation.endDate,
                  newStartDate: event.startDate,
                  newEndDate: event.endDate,
                });
              }
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

          // Soft cancellation flow (specs/ical-cancellation-approval.md §3 rule 1):
          // when a reservation's UID is no longer in this feed, drop this source's mapping
          // but DO NOT delete the reservation. If no OTHER source still references it,
          // record a pending cancellation alert for the Dashboard so the user explicitly
          // approves the deletion (or rejects it). Cross-platform-shared bookings still
          // survive until every feed drops them — the alert only fires once the last
          // mapping is gone.
          const staleMappings = listMappings
            .all(source.id)
            .filter((row) => !seenUids.has(row.eventUid));
          const countMappingsForReservation = database.prepare('SELECT COUNT(*) c FROM ical_import_events WHERE reservationId = ?');
          const reservationForCancellation = database.prepare('SELECT endDate FROM reservations WHERE id = ?');
          const todayIso = getTodayIsoDate();
          staleMappings.forEach((row) => {
            deleteMapping.run(source.id, row.eventUid);
            if (countMappingsForReservation.get(row.reservationId).c === 0) {
              // No other source still claims this reservation. Soft-record a pending
              // cancellation alert if the reservation still exists (a manual delete
              // between syncs is idempotent — we just drop the trailing mapping).
              const reservation = reservationForCancellation.get(row.reservationId);
              if (reservation) {
                // A PAST stay (checkout strictly before today) that the platform pruned
                // from its feed is NOT a cancellation to validate — platforms routinely
                // drop bygone bookings. Drop the stale mapping (already done above) and
                // keep the reservation, but raise no Dashboard alert (rule 1, past-stay
                // carve-out). Only present/future stays falling out of the feed are real
                // cancellations the operator must approve.
                const isPastStay = reservation.endDate && String(reservation.endDate) < todayIso;
                if (!isPastStay) {
                  cancellationModel.recordPending({
                    reservationId: row.reservationId,
                    sourceId: source.id,
                    eventUid: row.eventUid,
                  });
                  removedCount += 1;
                }
              }
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
          createdReservationIds,
          updatedCount,
          unchangedCount,
          lockedCount,
          removedCount,
          skippedClosureCount,
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
          // `removedCount` now counts soft-cancellation alerts raised on the Dashboard,
          // not deletions (specs/ical-cancellation-approval.md §3 rule 8).
          // `skippedClosureCount` (2026-06-06) — events dropped because they fell on a
          // declared establishment closure. Surfaced for operator visibility in
          // `ical_sources.lastSyncMessage`.
          `${result.createdCount} créé(s), ${result.updatedCount} mis à jour, ${result.lockedCount} verrouillé(s), ${result.removedCount} annulation(s) à valider${result.skippedClosureCount > 0 ? `, ${result.skippedClosureCount} ignoré(s) (fermeture)` : ''}, ${result.unchangedCount} inchangé(s)`,
          result.createdCount + result.updatedCount,
          source.id,
        );
        // Best-effort, post-commit, per-reservation notification for genuinely-new iCal imports
        // (specs/site-booking-notifications.md §3 rule 7). Fire-and-forget so a slow/unconfigured
        // SMTP never delays or breaks the sync; the service swallows its own errors.
        for (const reservationId of result.createdReservationIds || []) {
          Promise.resolve(notificationService.notifyNewIcalReservation(reservationId)).catch(() => {});
        }
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
