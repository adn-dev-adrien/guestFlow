const router = require('express').Router();
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const crypto = require('crypto');
const { sentenceCase } = require('../utils/textFormatters');
const {
  normalizeDateRanges,
  getBoundsFromDateRanges,
  parseRuleDateRanges,
  normalizeProgressiveTiers,
  buildProgressivePreview,
} = require('../utils/pricing');

const KNOWN_PLATFORM_COLORS = {
  direct: '#c9a227',
  airbnb: '#FF5A5F',
  greengo: '#4CAF50',
  abritel: '#1565c0',
  abracadaroom: '#00bcd4',
  booking: '#003580',
  gitedefrance: '#e6c832',
  pitchup: '#f57c00',
};

const DEFAULT_PLATFORM_COLOR = '#757575';

function normalizePlatformKey(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function toIsoDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIcalDate(rawValue, isDateOnly) {
  const value = String(rawValue || '').trim();
  if (!value) return '';

  const compact = value.replace(/[-:]/g, '');
  if (/^\d{8}$/.test(compact)) {
    const y = Number(compact.slice(0, 4));
    const m = Number(compact.slice(4, 6));
    const d = Number(compact.slice(6, 8));
    return toIsoDate(y, m, d);
  }

  if (/^\d{8}T\d{6}Z$/.test(compact)) {
    const y = Number(compact.slice(0, 4));
    const m = Number(compact.slice(4, 6));
    const d = Number(compact.slice(6, 8));
    const hh = Number(compact.slice(9, 11));
    const mm = Number(compact.slice(11, 13));
    const ss = Number(compact.slice(13, 15));
    const date = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
    return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  if (/^\d{8}T\d{6}$/.test(compact)) {
    const y = Number(compact.slice(0, 4));
    const m = Number(compact.slice(4, 6));
    const d = Number(compact.slice(6, 8));
    return toIsoDate(y, m, d);
  }

  if (!isDateOnly) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return toIsoDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
    }
  }

  return '';
}

function addIsoDays(dateStr, days) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return dateStr;
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function unfoldIcsLines(icsText) {
  const raw = String(icsText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function unescapeIcalText(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseAdultsFromText(summary, description) {
  const haystack = `${summary || ''}\n${description || ''}`;
  const regexes = [
    /(?:adultes?|adults?|guests?|voyageurs?)\s*[:=-]?\s*(\d{1,2})/i,
    /(\d{1,2})\s*(?:adultes?|adults?|guests?|voyageurs?)/i,
  ];
  for (const regex of regexes) {
    const match = haystack.match(regex);
    if (match) {
      const count = Number(match[1]);
      if (Number.isFinite(count) && count > 0) return Math.min(20, count);
    }
  }
  return 1;
}

function parseGuestName(summary, description) {
  const candidate = String(summary || '').trim() || String(description || '').split('\n')[0].trim();
  const cleaned = candidate
    .replace(/\b(airbnb|booking|abritel|greengo|direct|reservation|r[eé]servation|blocked|bloqu[eé]|indisponible)\b/gi, ' ')
    .replace(/[()\[\]{}:_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return { firstName: '', lastName: '', isFallback: true };
  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: 'iCal', isFallback: false };
  return { firstName: parts[0], lastName: parts.slice(1).join(' '), isFallback: false };
}

function resolveIcalClientIdentity(guestName, platformLabel) {
  const fallbackPlatformLabel = String(platformLabel || '').trim() || 'Plateforme';

  if (guestName?.isFallback) {
    return {
      firstName: 'Ical',
      lastName: fallbackPlatformLabel,
    };
  }

  return {
    firstName: sentenceCase(guestName?.firstName || 'Ical'),
    lastName: sentenceCase(guestName?.lastName || 'iCal'),
  };
}

function isUnavailableIcalEvent(summary, description) {
  const text = `${String(summary || '')}\n${String(description || '')}`
    .replace(/\u00a0/g, ' ')
    .toLowerCase();
  return /(blocked|not\s*available|unavailable|indisponible|non\s*disponible|\(\s*not\s*available\s*\))/i.test(text);
}

function parseIcsEvents(icsText) {
  const lines = unfoldIcsLines(icsText);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const colonIndex = line.indexOf(':');
    if (colonIndex < 0) continue;
    const left = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1);
    const [propNameRaw, ...paramParts] = left.split(';');
    const propName = String(propNameRaw || '').toUpperCase();
    const params = {};
    paramParts.forEach((part) => {
      const [k, v] = part.split('=');
      if (k && v) params[String(k).toUpperCase()] = v;
    });
    current[propName] = { value, params };
  }

  return events
    .map((event) => {
      const dtStartRaw = event.DTSTART?.value || '';
      const dtEndRaw = event.DTEND?.value || '';
      const startDate = parseIcalDate(dtStartRaw, event.DTSTART?.params?.VALUE === 'DATE');
      let endDate = parseIcalDate(dtEndRaw, event.DTEND?.params?.VALUE === 'DATE');
      if (!endDate && startDate) endDate = addIsoDays(startDate, 1);
      if (startDate && endDate && endDate <= startDate) endDate = addIsoDays(startDate, 1);

      const summary = unescapeIcalText(event.SUMMARY?.value || '');
      const description = unescapeIcalText(event.DESCRIPTION?.value || '');
      const status = String(event.STATUS?.value || '').toUpperCase();
      const uidBase = unescapeIcalText(event.UID?.value || '') || `${startDate}|${endDate}|${summary}`;
      const uid = uidBase || crypto.createHash('sha1').update(JSON.stringify(event)).digest('hex');
      const adults = parseAdultsFromText(summary, description);

      return {
        uid,
        startDate,
        endDate,
        summary,
        description,
        adults,
        status,
      };
    })
    .filter((event) => event.startDate && event.endDate && event.status !== 'CANCELLED' && !isUnavailableIcalEvent(event.summary, event.description));
}

function getOrCreateIcalClient(guestName, platformLabel) {
  const { firstName, lastName } = resolveIcalClientIdentity(guestName, platformLabel);
  const existing = db.prepare(`
    SELECT id FROM clients
    WHERE lower(firstName) = lower(?) AND lower(lastName) = lower(?)
    ORDER BY id
    LIMIT 1
  `).get(firstName, lastName);
  if (existing) return Number(existing.id);

  const result = db.prepare(`
    INSERT INTO clients (lastName, firstName, notes)
    VALUES (?, ?, ?)
  `).run(lastName, firstName, `${platformLabel}: créé automatiquement lors de l'import iCal`);
  return Number(result.lastInsertRowid);
}

function buildEventHash(event) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify({
      uid: event.uid,
      startDate: event.startDate,
      endDate: event.endDate,
      summary: event.summary,
      description: event.description,
      adults: event.adults,
    }))
    .digest('hex');
}

function shouldSkipIcalReservationUpdate(mappedReservation) {
  return String(mappedReservation?.sourceType || '') === 'ical'
    && Number(mappedReservation?.icalSyncLocked || 0) === 1;
}

function buildIcalCreationHistoryChanges(source, eventUid) {
  return [
    { field: 'sourceType', label: 'Origine', from: null, to: `Import iCal (${source?.platformLabel || source?.name || 'Source inconnue'})` },
    { field: 'sourceIcalEventUid', label: 'UID iCal', from: null, to: eventUid || '' },
  ];
}

function addReservationHistoryEntry(reservationId, eventType, changes) {
  db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)')
    .run(reservationId, eventType, JSON.stringify(changes || []));
}

function syncIcalSource(source) {
  return (async () => {
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
    const upsertMapping = db.prepare(`
      INSERT INTO ical_import_events (sourceId, eventUid, reservationId, eventHash, lastSeenAt)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(sourceId, eventUid)
      DO UPDATE SET reservationId=excluded.reservationId, eventHash=excluded.eventHash, lastSeenAt=datetime('now')
    `);
    const getReservationById = db.prepare('SELECT id, sourceType, icalSyncLocked FROM reservations WHERE id = ?');
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
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL, NULL, ?, ?, ?, 0, 0, 0, 0, NULL, 0, 0, NULL, 0, 'ical', ?, ?, ?, 0, ?, ?)
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
        const guestName = parseGuestName(event.summary, event.description);
        const clientId = getOrCreateIcalClient(guestName, source.platformLabel || source.name);
        const notes = `Import iCal (${source.name})\nUID: ${event.uid}${event.summary ? `\nRésumé: ${event.summary}` : ''}`;

        if (!mapping) {
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
          );
          const reservationId = Number(result.lastInsertRowid);
          upsertMapping.run(source.id, event.uid, reservationId, eventHash);
          addReservationHistoryEntry(reservationId, 'create', buildIcalCreationHistoryChanges(source, event.uid));
          createdCount += 1;
          continue;
        }

        const mappedReservation = getReservationById.get(mapping.reservationId);
        if (!mappedReservation) {
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
          );
          const reservationId = Number(result.lastInsertRowid);
          upsertMapping.run(source.id, event.uid, reservationId, eventHash);
          addReservationHistoryEntry(reservationId, 'create', buildIcalCreationHistoryChanges(source, event.uid));
          createdCount += 1;
          continue;
        }

        if (mapping.eventHash === eventHash) {
          unchangedCount += 1;
          continue;
        }

        if (shouldSkipIcalReservationUpdate(mappedReservation)) {
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

      // Remove reservations that were previously imported from this source
      // but are no longer present in the incoming iCal feed (or now filtered out).
      const staleMappings = listMappings
        .all(source.id)
        .filter((row) => !seenUids.has(row.eventUid));
      staleMappings.forEach((row) => {
        deleteReservation.run(row.reservationId);
        removedCount += 1;
      });

      // Cleanup orphan clients created by iCal imports.
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
      rawIcal: icsText,
      parsedEvents: events,
    };
  })();
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
});
const upload = multer({ storage });

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      cb(new Error('Le fichier photo doit être une image'));
      return;
    }
    cb(null, true);
  }
});

async function saveOptimizedPhoto(file) {
  if (!file) return '';
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}.webp`;
  const outputPath = path.join(uploadsDir, filename);
  await sharp(file.buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toFile(outputPath);
  return `/uploads/${filename}`;
}

function removeUploadedFile(filePath) {
  if (!filePath || !filePath.startsWith('/uploads/')) return;
  const absPath = path.join(uploadsDir, path.basename(filePath));
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
}

function findPricingRuleOverlap(propertyId, dateRanges, excludeRuleId = null) {
  if (!dateRanges.length) return null;
  let sql = 'SELECT id, label, startDate, endDate, dateRanges FROM pricing_rules WHERE propertyId = ?';
  const params = [propertyId];
  if (excludeRuleId) {
    sql += ' AND id != ?';
    params.push(excludeRuleId);
  }
  sql += ' ORDER BY startDate';
  const rules = db.prepare(sql).all(...params);

  for (const rule of rules) {
    const existingRanges = parseRuleDateRanges(rule);
    for (const incomingRange of dateRanges) {
      const conflictingRange = existingRanges.find((existingRange) => (
        incomingRange.startDate <= existingRange.endDate && incomingRange.endDate >= existingRange.startDate
      ));
      if (conflictingRange) {
        return {
          id: rule.id,
          label: rule.label,
          startDate: conflictingRange.startDate,
          endDate: conflictingRange.endDate,
        };
      }
    }
  }

  return null;
}

// List all properties
router.get('/', (req, res) => {
  const properties = db.prepare('SELECT * FROM properties ORDER BY name').all();
  res.json(properties);
});

router.get('/platform-colors', (req, res) => {
  const customRows = db.prepare(`
    SELECT platformKey, platformColor
    FROM ical_sources
    WHERE isActive = 1
      AND platformKey IS NOT NULL
      AND trim(platformKey) != ''
      AND platformColor IS NOT NULL
      AND trim(platformColor) != ''
    ORDER BY updatedAt DESC, id DESC
  `).all();

  const customColors = {};
  customRows.forEach((row) => {
    const key = normalizePlatformKey(row.platformKey);
    if (!key || customColors[key]) return;
    customColors[key] = row.platformColor;
  });

  res.json({
    knownColors: KNOWN_PLATFORM_COLORS,
    customColors,
  });
});

// Get single property with pricing rules, documents, and available options
router.get('/:id', (req, res) => {
  const property = db.prepare('SELECT * FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Logement non trouvé' });

  property.pricingRules = db.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(req.params.id)
    .map((rule) => {
      let tiers = [];
      try {
        tiers = JSON.parse(rule.progressiveTiers || '[]');
      } catch {
        tiers = [];
      }
      return {
        ...rule,
        pricingMode: rule.pricingMode || 'fixed',
        color: rule.color || '#1976d2',
        dateRanges: parseRuleDateRanges(rule),
        progressiveTiers: Array.isArray(tiers) ? tiers : [],
      };
    });
  property.documents = db.prepare('SELECT * FROM documents WHERE propertyId = ?').all(req.params.id);
  property.optionIds = db.prepare('SELECT optionId FROM property_options WHERE propertyId = ?').all(req.params.id).map(r => r.optionId);
  property.icalSources = db.prepare(`
    SELECT id, propertyId, name, url, platformKey, platformLabel, platformColor, isActive,
      lastSyncAt, lastSyncStatus, lastSyncMessage, lastImportedCount, createdAt, updatedAt
    FROM ical_sources
    WHERE propertyId = ?
    ORDER BY name COLLATE NOCASE, id DESC
  `).all(req.params.id);
  res.json(property);
});

router.post('/:id/pricing/progressive-preview', (req, res) => {
  const { pricePerNight, progressiveTiers, maxNights } = req.body;
  const preview = buildProgressivePreview(Number(pricePerNight || 0), progressiveTiers, Number(maxNights || 14));
  res.json(preview);
});

// Create property
router.post('/', photoUpload.single('photo'), async (req, res) => {
  try {
    const { name, maxAdults, maxChildren, maxBabies, singleBeds, doubleBeds, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, cleaningHours, defaultCautionAmount, touristTaxPerDayPerPerson } = req.body;
    const photo = req.file ? await saveOptimizedPhoto(req.file) : '';
    const result = db.prepare(`
      INSERT INTO properties (name, photo, maxAdults, maxChildren, maxBabies, singleBeds, doubleBeds, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, cleaningHours, defaultCautionAmount, touristTaxPerDayPerPerson)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sentenceCase(name), photo, maxAdults || 2, maxChildren || 0, maxBabies || 0, singleBeds ?? 0, doubleBeds ?? 0, depositPercent || 30, depositDaysBefore || 30, balanceDaysBefore || 7, defaultCheckIn || '15:00', defaultCheckOut || '10:00', cleaningHours || 3, defaultCautionAmount ?? 500, touristTaxPerDayPerPerson ?? 0);

    const propertyId = result.lastInsertRowid;
    const currentYear = new Date().getFullYear();
    db.prepare(`
      INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      propertyId,
      'Tarif annuel',
      100,
      'fixed',
      '[]',
      JSON.stringify([{ startDate: `${currentYear}-01-01`, endDate: `${currentYear}-12-31` }]),
      '#1976d2',
      `${currentYear}-01-01`,
      `${currentYear}-12-31`,
      1
    );
    res.json({ id: propertyId });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la création du logement' });
  }
});

// Update property
router.put('/:id', photoUpload.single('photo'), async (req, res) => {
  try {
    const { name, maxAdults, maxChildren, maxBabies, singleBeds, doubleBeds, depositPercent, depositDaysBefore, balanceDaysBefore, defaultCheckIn, defaultCheckOut, cleaningHours, defaultCautionAmount, touristTaxPerDayPerPerson } = req.body;
    const existing = db.prepare('SELECT photo FROM properties WHERE id = ?').get(req.params.id);
    const newPhoto = req.file ? await saveOptimizedPhoto(req.file) : '';
    const photo = newPhoto || (req.body.photo || (existing ? existing.photo : ''));

    db.prepare(`
      UPDATE properties SET name=?, photo=?, maxAdults=?, maxChildren=?, maxBabies=?, singleBeds=?, doubleBeds=?, depositPercent=?, depositDaysBefore=?, balanceDaysBefore=?, defaultCheckIn=?, defaultCheckOut=?, cleaningHours=?, defaultCautionAmount=?, touristTaxPerDayPerPerson=?, updatedAt=datetime('now')
      WHERE id=?
    `).run(sentenceCase(name), photo, maxAdults || 2, maxChildren || 0, maxBabies || 0, singleBeds ?? 0, doubleBeds ?? 0, depositPercent || 30, depositDaysBefore || 30, balanceDaysBefore || 7, defaultCheckIn || '15:00', defaultCheckOut || '10:00', cleaningHours || 3, defaultCautionAmount ?? 500, touristTaxPerDayPerPerson ?? 0, req.params.id);

    if (newPhoto && existing && existing.photo && existing.photo !== newPhoto) {
      removeUploadedFile(existing.photo);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la mise à jour du logement' });
  }
});

// Delete property
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT photo FROM properties WHERE id = ?').get(req.params.id);
  if (!existing) return res.json({ ok: true });

  // Capture client IDs linked to this property's reservations BEFORE deletion,
  // so we can clean up orphan clients afterwards.
  const affectedClientIds = db
    .prepare('SELECT DISTINCT clientId FROM reservations WHERE propertyId = ?')
    .all(req.params.id)
    .map((r) => r.clientId);

  db.transaction(() => {
    // Deleting the property cascades to: reservations, reservation_options,
    // reservation_resources, reservation_nights, reservation_history,
    // pricing_rules, documents, property_options, ical_sources,
    // ical_import_events, calendar_notes.
    db.prepare('DELETE FROM properties WHERE id = ?').run(req.params.id);

    // Remove clients that now have no reservations on any property.
    // Clients still linked to reservations on other properties are preserved.
    if (affectedClientIds.length > 0) {
      const placeholders = affectedClientIds.map(() => '?').join(',');
      db.prepare(`
        DELETE FROM clients
        WHERE id IN (${placeholders})
          AND NOT EXISTS (SELECT 1 FROM reservations WHERE clientId = clients.id)
      `).run(...affectedClientIds);
    }
  })();

  if (existing.photo) removeUploadedFile(existing.photo);
  res.json({ ok: true });
});

// --- Pricing Rules ---
router.post('/:id/pricing', (req, res) => {
  const { label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights } = req.body;
  const normalizedDateRanges = normalizeDateRanges(dateRanges, startDate, endDate);
  const normalizedProgressiveTiers = pricingMode === 'progressive'
    ? normalizeProgressiveTiers(Number(pricePerNight || 0), progressiveTiers)
    : [];
  const conflictingRule = findPricingRuleOverlap(req.params.id, normalizedDateRanges);
  if (conflictingRule) {
    return res.status(400).json({
      error: `Chevauchement avec la saison "${conflictingRule.label}" (${conflictingRule.startDate} au ${conflictingRule.endDate}).`,
      conflictingRule,
    });
  }
  const bounds = getBoundsFromDateRanges(normalizedDateRanges);
  const result = db.prepare(`
    INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id,
    sentenceCase(label || 'Standard'),
    Number(pricePerNight || 0),
    pricingMode || 'fixed',
    JSON.stringify(normalizedProgressiveTiers),
    JSON.stringify(normalizedDateRanges),
    color || '#1976d2',
    bounds.startDate,
    bounds.endDate,
    minNights || 1
  );
  res.json({ id: result.lastInsertRowid });
});

router.put('/:id/pricing/:ruleId', (req, res) => {
  const { label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights } = req.body;
  const normalizedDateRanges = normalizeDateRanges(dateRanges, startDate, endDate);
  const normalizedProgressiveTiers = pricingMode === 'progressive'
    ? normalizeProgressiveTiers(Number(pricePerNight || 0), progressiveTiers)
    : [];
  const conflictingRule = findPricingRuleOverlap(req.params.id, normalizedDateRanges, req.params.ruleId);
  if (conflictingRule) {
    return res.status(400).json({
      error: `Chevauchement avec la saison "${conflictingRule.label}" (${conflictingRule.startDate} au ${conflictingRule.endDate}).`,
      conflictingRule,
    });
  }
  const bounds = getBoundsFromDateRanges(normalizedDateRanges);
  db.prepare(`
    UPDATE pricing_rules SET label=?, pricePerNight=?, pricingMode=?, progressiveTiers=?, dateRanges=?, color=?, startDate=?, endDate=?, minNights=?
    WHERE id=? AND propertyId=?
  `).run(
    sentenceCase(label || 'Standard'),
    Number(pricePerNight || 0),
    pricingMode || 'fixed',
    JSON.stringify(normalizedProgressiveTiers),
    JSON.stringify(normalizedDateRanges),
    color || '#1976d2',
    bounds.startDate,
    bounds.endDate,
    minNights || 1,
    req.params.ruleId,
    req.params.id
  );
  res.json({ ok: true });
});

router.delete('/:id/pricing/:ruleId', (req, res) => {
  db.prepare('DELETE FROM pricing_rules WHERE id = ? AND propertyId = ?').run(req.params.ruleId, req.params.id);
  res.json({ ok: true });
});

router.post('/:id/pricing/apply-to', (req, res) => {
  const sourcePropertyId = Number(req.params.id);
  const targetPropertyId = Number(req.body.targetPropertyId);
  const replaceExisting = Boolean(req.body.replaceExisting);

  if (!targetPropertyId) {
    return res.status(400).json({ error: 'Le logement cible est requis.' });
  }
  if (sourcePropertyId === targetPropertyId) {
    return res.status(400).json({ error: 'Le logement source et le logement cible doivent être différents.' });
  }

  const sourceProperty = db.prepare('SELECT id, name FROM properties WHERE id = ?').get(sourcePropertyId);
  if (!sourceProperty) {
    return res.status(404).json({ error: 'Logement source introuvable.' });
  }
  const targetProperty = db.prepare('SELECT id, name FROM properties WHERE id = ?').get(targetPropertyId);
  if (!targetProperty) {
    return res.status(404).json({ error: 'Logement cible introuvable.' });
  }

  const sourceRules = db.prepare('SELECT * FROM pricing_rules WHERE propertyId = ? ORDER BY startDate').all(sourcePropertyId);
  if (!sourceRules.length) {
    return res.status(400).json({ error: 'Aucune saison à appliquer pour le logement source.' });
  }

  const normalizedSourceRules = sourceRules.map((rule) => {
    const normalizedDateRanges = normalizeDateRanges(parseRuleDateRanges(rule), rule.startDate, rule.endDate);
    const bounds = getBoundsFromDateRanges(normalizedDateRanges);
    return {
      label: sentenceCase(rule.label || 'Standard'),
      pricePerNight: Number(rule.pricePerNight || 0),
      pricingMode: rule.pricingMode || 'fixed',
      progressiveTiers: rule.progressiveTiers || '[]',
      dateRanges: JSON.stringify(normalizedDateRanges),
      color: rule.color || '#1976d2',
      startDate: bounds.startDate,
      endDate: bounds.endDate,
      minNights: Number(rule.minNights || 1),
      normalizedDateRanges,
    };
  });

  if (!replaceExisting) {
    for (const sourceRule of normalizedSourceRules) {
      const conflict = findPricingRuleOverlap(targetPropertyId, sourceRule.normalizedDateRanges);
      if (conflict) {
        return res.status(409).json({
          error: `Impossible d'appliquer: chevauchement avec la saison "${conflict.label}" du logement cible (${conflict.startDate} au ${conflict.endDate}).`,
          code: 'PRICING_OVERLAP',
          conflictingRule: conflict,
        });
      }
    }
  }

  const insertRule = db.prepare(`
    INSERT INTO pricing_rules (propertyId, label, pricePerNight, pricingMode, progressiveTiers, dateRanges, color, startDate, endDate, minNights)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const applyTransaction = db.transaction(() => {
    if (replaceExisting) {
      db.prepare('DELETE FROM pricing_rules WHERE propertyId = ?').run(targetPropertyId);
    }
    for (const rule of normalizedSourceRules) {
      insertRule.run(
        targetPropertyId,
        rule.label,
        rule.pricePerNight,
        rule.pricingMode,
        rule.progressiveTiers,
        rule.dateRanges,
        rule.color,
        rule.startDate,
        rule.endDate,
        rule.minNights,
      );
    }
  });

  applyTransaction();
  return res.json({ ok: true, copiedRules: normalizedSourceRules.length, replaceExisting });
});

// --- Documents ---
router.post('/:id/documents', upload.single('file'), (req, res) => {
  const { type, name } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Fichier requis' });
  const filePath = `/uploads/${req.file.filename}`;
  const result = db.prepare(`
    INSERT INTO documents (propertyId, type, name, filePath) VALUES (?, ?, ?, ?)
  `).run(req.params.id, type || 'other', sentenceCase(name || req.file.originalname), filePath);
  res.json({ id: result.lastInsertRowid, filePath });
});

router.delete('/:id/documents/:docId', (req, res) => {
  db.prepare('DELETE FROM documents WHERE id = ? AND propertyId = ?').run(req.params.docId, req.params.id);
  res.json({ ok: true });
});

// --- Property options linkage ---
router.put('/:id/options', (req, res) => {
  const { optionIds } = req.body; // array of option ids
  const deleteAll = db.prepare('DELETE FROM property_options WHERE propertyId = ?');
  const insert = db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)');
  const transaction = db.transaction(() => {
    deleteAll.run(req.params.id);
    for (const oid of (optionIds || [])) {
      insert.run(req.params.id, oid);
    }
  });
  transaction();
  res.json({ ok: true });
});

router.get('/:id/ical-sources', (req, res) => {
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(req.params.id);
  if (!property) return res.status(404).json({ error: 'Logement non trouvé' });

  const sources = db.prepare(`
    SELECT id, propertyId, name, url, platformKey, platformLabel, platformColor, isActive,
      lastSyncAt, lastSyncStatus, lastSyncMessage, lastImportedCount, createdAt, updatedAt
    FROM ical_sources
    WHERE propertyId = ?
    ORDER BY name COLLATE NOCASE, id DESC
  `).all(req.params.id);
  res.json(sources);
});

router.post('/:id/ical-sources', (req, res) => {
  const propertyId = Number(req.params.id);
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(propertyId);
  if (!property) return res.status(404).json({ error: 'Logement non trouvé' });

  const url = String(req.body.url || '').trim();
  const platformKeyInput = String(req.body.platformKey || '').trim();
  const platformLabelInput = String(req.body.platformLabel || '').trim();
  const normalizedPlatformKey = normalizePlatformKey(platformKeyInput || platformLabelInput);
  const platformLabel = sentenceCase(platformLabelInput || platformKeyInput || normalizedPlatformKey);
  const name = platformLabel;

  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL iCal invalide (http(s) requis).' });
  if (!normalizedPlatformKey) return res.status(400).json({ error: 'La plateforme est requise.' });

  const knownColor = KNOWN_PLATFORM_COLORS[normalizedPlatformKey];
  const chosenColor = String(req.body.platformColor || '').trim();
  const platformColor = knownColor || chosenColor || DEFAULT_PLATFORM_COLOR;

  const result = db.prepare(`
    INSERT INTO ical_sources (
      propertyId, name, url, platformKey, platformLabel, platformColor, isActive, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(propertyId, name, url, normalizedPlatformKey, platformLabel, platformColor, req.body.isActive === false ? 0 : 1);

  const created = db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(result.lastInsertRowid);
  res.json(created);
});

router.put('/:id/ical-sources/:sourceId', (req, res) => {
  const propertyId = Number(req.params.id);
  const sourceId = Number(req.params.sourceId);
  const existing = db.prepare('SELECT * FROM ical_sources WHERE id = ? AND propertyId = ?').get(sourceId, propertyId);
  if (!existing) return res.status(404).json({ error: 'Connexion iCal introuvable.' });

  const url = String(req.body.url ?? existing.url).trim();
  const platformKeyInput = String(req.body.platformKey ?? existing.platformKey).trim();
  const platformLabelInput = String(req.body.platformLabel ?? existing.platformLabel).trim();
  const normalizedPlatformKey = normalizePlatformKey(platformKeyInput || platformLabelInput);
  const platformLabel = sentenceCase(platformLabelInput || platformKeyInput || normalizedPlatformKey);
  const name = platformLabel;

  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL iCal invalide (http(s) requis).' });
  if (!normalizedPlatformKey) return res.status(400).json({ error: 'La plateforme est requise.' });

  const knownColor = KNOWN_PLATFORM_COLORS[normalizedPlatformKey];
  const chosenColor = String(req.body.platformColor || '').trim();
  const platformColor = knownColor || chosenColor || existing.platformColor || DEFAULT_PLATFORM_COLOR;
  const isActive = req.body.isActive === undefined ? existing.isActive : (req.body.isActive ? 1 : 0);

  db.prepare(`
    UPDATE ical_sources
    SET name = ?, url = ?, platformKey = ?, platformLabel = ?, platformColor = ?, isActive = ?, updatedAt = datetime('now')
    WHERE id = ? AND propertyId = ?
  `).run(name, url, normalizedPlatformKey, platformLabel, platformColor, isActive, sourceId, propertyId);

  const updated = db.prepare('SELECT * FROM ical_sources WHERE id = ?').get(sourceId);
  res.json(updated);
});

router.delete('/:id/ical-sources/:sourceId', (req, res) => {
  const propertyId = Number(req.params.id);
  const sourceId = Number(req.params.sourceId);
  db.prepare('DELETE FROM ical_sources WHERE id = ? AND propertyId = ?').run(sourceId, propertyId);
  res.json({ ok: true });
});

router.post('/:id/ical-sources/:sourceId/sync', async (req, res) => {
  const propertyId = Number(req.params.id);
  const sourceId = Number(req.params.sourceId);
  const source = db.prepare('SELECT * FROM ical_sources WHERE id = ? AND propertyId = ?').get(sourceId, propertyId);
  if (!source) return res.status(404).json({ error: 'Connexion iCal introuvable.' });

  try {
    const result = await syncIcalSource(source);
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
      sourceId,
    );
    res.json(result);
  } catch (error) {
    db.prepare(`
      UPDATE ical_sources
      SET lastSyncAt = datetime('now'),
          lastSyncStatus = 'error',
          lastSyncMessage = ?,
          updatedAt = datetime('now')
      WHERE id = ?
    `).run(String(error.message || 'Erreur de synchronisation iCal'), sourceId);
    res.status(400).json({ error: String(error.message || 'Erreur de synchronisation iCal') });
  }
});

router.post('/:id/ical-sources/sync-all', async (req, res) => {
  const propertyId = Number(req.params.id);
  const sources = db.prepare('SELECT * FROM ical_sources WHERE propertyId = ? AND isActive = 1 ORDER BY id').all(propertyId);
  if (!sources.length) return res.json({ ok: true, results: [] });

  const results = [];
  for (const source of sources) {
    try {
      const result = await syncIcalSource(source);
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
        source.id,
      );
      results.push({ sourceId: source.id, sourceName: source.name, ok: true, ...result });
    } catch (error) {
      db.prepare(`
        UPDATE ical_sources
        SET lastSyncAt = datetime('now'),
            lastSyncStatus = 'error',
            lastSyncMessage = ?,
            updatedAt = datetime('now')
        WHERE id = ?
      `).run(String(error.message || 'Erreur de synchronisation iCal'), source.id);
      results.push({ sourceId: source.id, sourceName: source.name, ok: false, error: String(error.message || 'Erreur de synchronisation iCal') });
    }
  }

  res.json({ ok: true, results });
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Photo trop volumineuse (max 5 Mo)' });
    }
    return res.status(400).json({ error: err.message || 'Erreur upload' });
  }
  if (err && err.message === 'Le fichier photo doit être une image') {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

module.exports = router;
module.exports.__test = {
  normalizePlatformKey,
  parseIcalDate,
  unfoldIcsLines,
  parseAdultsFromText,
  parseGuestName,
  resolveIcalClientIdentity,
  isUnavailableIcalEvent,
  parseIcsEvents,
  buildEventHash,
  shouldSkipIcalReservationUpdate,
  buildIcalCreationHistoryChanges,
};
