const router = require('express').Router();
const db = require('../database');

// List all options
router.get('/', (req, res) => {
  const options = db.prepare('SELECT * FROM options ORDER BY title').all();
  res.json(options);
});

// Get single option
router.get('/:id', (req, res) => {
  const option = db.prepare('SELECT * FROM options WHERE id = ?').get(req.params.id);
  if (!option) return res.status(404).json({ error: 'Option non trouvée' });
  res.json(option);
});

// Create option
router.post('/', (req, res) => {
  const { title, description, priceType, price } = req.body;
  const result = db.prepare(`
    INSERT INTO options (title, description, priceType, price) VALUES (?, ?, ?, ?)
  `).run(title, description || '', priceType || 'per_stay', price || 0);
  res.json({ id: result.lastInsertRowid });
});

// Update option
router.put('/:id', (req, res) => {
  const { title, description, priceType, price } = req.body;
  db.prepare(`
    UPDATE options SET title=?, description=?, priceType=?, price=? WHERE id=?
  `).run(title, description || '', priceType || 'per_stay', price || 0, req.params.id);
  res.json({ ok: true });
});

// Delete option
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM options WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
