const router = require('express').Router();
const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');

function normalizeClientRow(row) {
  let phoneNumbers = [];
  try {
    phoneNumbers = row.phoneNumbers ? JSON.parse(row.phoneNumbers) : [];
  } catch {
    phoneNumbers = [];
  }
  if ((!Array.isArray(phoneNumbers) || phoneNumbers.length === 0) && row.phone) {
    phoneNumbers = [row.phone];
  }
  return {
    ...row,
    phoneNumbers,
  };
}

// List all clients (with optional search)
router.get('/', (req, res) => {
  const { q } = req.query;
  let clients;
  if (q) {
    const search = `%${q}%`;
    clients = db.prepare(`
      SELECT * FROM clients
      WHERE lastName LIKE ? OR firstName LIKE ? OR email LIKE ? OR phone LIKE ?
        OR street LIKE ? OR city LIKE ? OR postalCode LIKE ?
      ORDER BY lastName, firstName
    `).all(search, search, search, search, search, search, search);
  } else {
    clients = db.prepare('SELECT * FROM clients ORDER BY lastName, firstName').all();
  }
  res.json(clients.map(normalizeClientRow));
});

// Get single client
router.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });
  res.json(normalizeClientRow(client));
});

// Create client
router.post('/', (req, res) => {
  const {
    lastName,
    firstName,
    streetNumber,
    street,
    postalCode,
    city,
    address,
    phone,
    phoneNumbers,
    email,
    notes
  } = req.body;
  const normalizedPhones = Array.isArray(phoneNumbers)
    ? phoneNumbers.filter((p) => String(p || '').trim() !== '')
    : (phone ? [phone] : []);
  const mainPhone = normalizedPhones[0] || '';
  const normalizedLastName = sentenceCase(lastName);
  const normalizedFirstName = sentenceCase(firstName);
  const normalizedStreetNumber = String(streetNumber || '').trim();
  const normalizedStreet = sentenceCase(street);
  const normalizedCity = sentenceCase(city);
  const normalizedAddress = sentenceCase(address);
  const computedAddress = normalizedAddress || sentenceCase([normalizedStreetNumber, normalizedStreet].filter(Boolean).join(' '));
  const normalizedNotes = sentenceCase(notes);
  const result = db.prepare(`
    INSERT INTO clients (lastName, firstName, streetNumber, street, postalCode, city, address, phone, phoneNumbers, email, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalizedLastName,
    normalizedFirstName,
    normalizedStreetNumber,
    normalizedStreet,
    postalCode || '',
    normalizedCity,
    computedAddress || '',
    mainPhone,
    JSON.stringify(normalizedPhones),
    email || '',
    normalizedNotes
  );
  res.json({
    id: result.lastInsertRowid,
    ...req.body,
    lastName: normalizedLastName,
    firstName: normalizedFirstName,
    streetNumber: normalizedStreetNumber,
    street: normalizedStreet,
    city: normalizedCity,
    address: computedAddress,
    phone: mainPhone,
    phoneNumbers: normalizedPhones,
    notes: normalizedNotes,
  });
});

// Update client
router.put('/:id', (req, res) => {
  const {
    lastName,
    firstName,
    streetNumber,
    street,
    postalCode,
    city,
    address,
    phone,
    phoneNumbers,
    email,
    notes
  } = req.body;
  const normalizedPhones = Array.isArray(phoneNumbers)
    ? phoneNumbers.filter((p) => String(p || '').trim() !== '')
    : (phone ? [phone] : []);
  const mainPhone = normalizedPhones[0] || '';
  const normalizedLastName = sentenceCase(lastName);
  const normalizedFirstName = sentenceCase(firstName);
  const normalizedStreetNumber = String(streetNumber || '').trim();
  const normalizedStreet = sentenceCase(street);
  const normalizedCity = sentenceCase(city);
  const normalizedAddress = sentenceCase(address);
  const computedAddress = normalizedAddress || sentenceCase([normalizedStreetNumber, normalizedStreet].filter(Boolean).join(' '));
  const normalizedNotes = sentenceCase(notes);
  db.prepare(`
    UPDATE clients
    SET lastName=?, firstName=?, streetNumber=?, street=?, postalCode=?, city=?, address=?, phone=?, phoneNumbers=?, email=?, notes=?, updatedAt=datetime('now')
    WHERE id=?
  `).run(
    normalizedLastName,
    normalizedFirstName,
    normalizedStreetNumber,
    normalizedStreet,
    postalCode || '',
    normalizedCity,
    computedAddress || '',
    mainPhone,
    JSON.stringify(normalizedPhones),
    email || '',
    normalizedNotes,
    req.params.id
  );
  res.json({
    id: Number(req.params.id),
    ...req.body,
    lastName: normalizedLastName,
    firstName: normalizedFirstName,
    streetNumber: normalizedStreetNumber,
    street: normalizedStreet,
    city: normalizedCity,
    address: computedAddress,
    phone: mainPhone,
    phoneNumbers: normalizedPhones,
    notes: normalizedNotes,
  });
});

// Delete client
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
