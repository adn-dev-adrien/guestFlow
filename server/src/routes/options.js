const router = require('express').Router();
const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');

// List all options
router.get('/', (req, res) => {
  const options = db.prepare('SELECT * FROM options ORDER BY title').all();
  const propStmt = db.prepare('SELECT propertyId FROM property_options WHERE optionId = ? ORDER BY propertyId');
  options.forEach((o) => {
    o.propertyIds = propStmt.all(o.id).map(r => r.propertyId);
  });
  res.json(options);
});

// Get single option
router.get('/:id', (req, res) => {
  const option = db.prepare('SELECT * FROM options WHERE id = ?').get(req.params.id);
  if (!option) return res.status(404).json({ error: 'Option non trouvée' });
  option.propertyIds = db.prepare('SELECT propertyId FROM property_options WHERE optionId = ? ORDER BY propertyId').all(req.params.id).map(r => r.propertyId);
  res.json(option);
});

// Create option
router.post('/', (req, res) => {
  const { title, description, priceType, price, propertyIds } = req.body;
  const insertOption = db.prepare('INSERT INTO options (title, description, priceType, price) VALUES (?, ?, ?, ?)');
  const insertLink = db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)');
  const transaction = db.transaction(() => {
    const result = insertOption.run(sentenceCase(title), sentenceCase(description), priceType || 'per_stay', price || 0);
    const optionId = result.lastInsertRowid;
    for (const pid of (propertyIds || [])) {
      insertLink.run(pid, optionId);
    }
    return optionId;
  });
  const optionId = transaction();
  res.json({ id: optionId });
});

// Update option
router.put('/:id', (req, res) => {
  const { title, description, priceType, price, propertyIds } = req.body;
  const updateOption = db.prepare('UPDATE options SET title=?, description=?, priceType=?, price=? WHERE id=?');
  const deleteLinks = db.prepare('DELETE FROM property_options WHERE optionId = ?');
  const insertLink = db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)');
  const transaction = db.transaction(() => {
    updateOption.run(sentenceCase(title), sentenceCase(description), priceType || 'per_stay', price || 0, req.params.id);
    deleteLinks.run(req.params.id);
    for (const pid of (propertyIds || [])) {
      insertLink.run(pid, req.params.id);
    }
  });
  transaction();
  res.json({ ok: true });
});

// Delete option
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM property_options WHERE optionId = ?').run(req.params.id);
  db.prepare('DELETE FROM options WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
