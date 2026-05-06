const router = require('express').Router();
const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');

const LATE_CHECKOUT_BLOCK_HOUR = 17;
const EARLY_CHECKIN_BLOCK_HOUR = 10;

function validateRange(startDate, endDate) {
  if (!startDate || !endDate) {
    return 'Les dates de début et de fin sont obligatoires.';
  }
  if (startDate >= endDate) {
    return 'La date de fin doit être postérieure à la date de début.';
  }
  return null;
}

function findReservationOverlap(startDate, endDate) {
  const row = db.prepare(`
    SELECT r.id, r.propertyId, r.startDate, r.endDate, p.name AS propertyName
    FROM reservations r
    JOIN properties p ON p.id = r.propertyId
    WHERE (CASE WHEN CAST(SUBSTR(COALESCE(r.checkInTime, '15:00'), 1, 2) AS INTEGER) <= ${EARLY_CHECKIN_BLOCK_HOUR}
                THEN date(r.startDate, '-1 day') ELSE r.startDate END) < ?
      AND (CASE WHEN CAST(SUBSTR(COALESCE(r.checkOutTime, '10:00'), 1, 2) AS INTEGER) >= ${LATE_CHECKOUT_BLOCK_HOUR}
                THEN date(r.endDate, '+1 day') ELSE r.endDate END) > ?
    ORDER BY r.startDate ASC
    LIMIT 1
  `).get(endDate, startDate);
  return row || null;
}

function findClosureOverlap(startDate, endDate, excludeId = null) {
  let sql = `
    SELECT id
    FROM establishment_closures
    WHERE startDate < ?
      AND endDate > ?
  `;
  const params = [endDate, startDate];
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(Number(excludeId));
  }
  return db.prepare(sql).get(...params) || null;
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM establishment_closures ORDER BY startDate ASC, id ASC').all();
  res.json(rows);
});

router.post('/', (req, res) => {
  const startDate = req.body.startDate;
  const endDate = req.body.endDate;
  const label = sentenceCase(req.body.label || 'Fermeture établissement');

  const rangeError = validateRange(startDate, endDate);
  if (rangeError) return res.status(400).json({ error: rangeError });

  const overlappingReservation = findReservationOverlap(startDate, endDate);
  if (overlappingReservation) {
    return res.status(409).json({
      error: `Fermeture impossible: une réservation existe déjà sur cette période (${overlappingReservation.propertyName}, du ${overlappingReservation.startDate} au ${overlappingReservation.endDate}).`,
      code: 'RESERVATION_OVERLAP',
    });
  }

  const overlappingClosure = findClosureOverlap(startDate, endDate);
  if (overlappingClosure) {
    return res.status(409).json({ error: 'Cette période chevauche déjà une fermeture existante.', code: 'CLOSURE_OVERLAP' });
  }

  const result = db.prepare(`
    INSERT INTO establishment_closures (label, startDate, endDate, updatedAt)
    VALUES (?, ?, ?, datetime('now'))
  `).run(label || 'Fermeture établissement', startDate, endDate);

  res.json({ id: result.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM establishment_closures WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Période de fermeture introuvable.' });

  const startDate = req.body.startDate;
  const endDate = req.body.endDate;
  const label = sentenceCase(req.body.label || 'Fermeture établissement');

  const rangeError = validateRange(startDate, endDate);
  if (rangeError) return res.status(400).json({ error: rangeError });

  const overlappingReservation = findReservationOverlap(startDate, endDate);
  if (overlappingReservation) {
    return res.status(409).json({
      error: `Fermeture impossible: une réservation existe déjà sur cette période (${overlappingReservation.propertyName}, du ${overlappingReservation.startDate} au ${overlappingReservation.endDate}).`,
      code: 'RESERVATION_OVERLAP',
    });
  }

  const overlappingClosure = findClosureOverlap(startDate, endDate, id);
  if (overlappingClosure) {
    return res.status(409).json({ error: 'Cette période chevauche déjà une fermeture existante.', code: 'CLOSURE_OVERLAP' });
  }

  db.prepare(`
    UPDATE establishment_closures
    SET label = ?, startDate = ?, endDate = ?, updatedAt = datetime('now')
    WHERE id = ?
  `).run(label || 'Fermeture établissement', startDate, endDate, id);

  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM establishment_closures WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
