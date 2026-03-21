const router = require('express').Router();
const db = require('../database');

// List all clients (with optional search)
router.get('/', (req, res) => {
  const { q } = req.query;
  let clients;
  if (q) {
    const search = `%${q}%`;
    clients = db.prepare(`
      SELECT * FROM clients
      WHERE lastName LIKE ? OR firstName LIKE ? OR email LIKE ? OR phone LIKE ?
      ORDER BY lastName, firstName
    `).all(search, search, search, search);
  } else {
    clients = db.prepare('SELECT * FROM clients ORDER BY lastName, firstName').all();
  }
  res.json(clients);
});

// Get single client
router.get('/:id', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!client) return res.status(404).json({ error: 'Client non trouvé' });
  res.json(client);
});

// Create client
router.post('/', (req, res) => {
  const { lastName, firstName, address, phone, email, notes } = req.body;
  const result = db.prepare(`
    INSERT INTO clients (lastName, firstName, address, phone, email, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(lastName, firstName, address || '', phone || '', email || '', notes || '');
  res.json({ id: result.lastInsertRowid, ...req.body });
});

// Update client
router.put('/:id', (req, res) => {
  const { lastName, firstName, address, phone, email, notes } = req.body;
  db.prepare(`
    UPDATE clients SET lastName=?, firstName=?, address=?, phone=?, email=?, notes=?, updatedAt=datetime('now')
    WHERE id=?
  `).run(lastName, firstName, address || '', phone || '', email || '', notes || '', req.params.id);
  res.json({ id: Number(req.params.id), ...req.body });
});

// Delete client
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
