const router = require('express').Router();
const db = require('../database');

// Get iCal token for a property (creates one if it doesn't exist)
router.get('/token/:propertyId', (req, res) => {
  const propertyId = Number(req.params.propertyId);
  
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(propertyId);
  if (!property) {
    return res.status(404).json({ error: 'Propriété introuvable' });
  }
  
  try {
    const token = db.getOrCreateIcalToken(propertyId);
    res.json({ token, url: `${process.env.BASE_URL || 'http://localhost:4000'}/api/ical/export/${token}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export property reservations as iCal format (public endpoint)
router.get('/export/:token', (req, res) => {
  const token = req.params.token;
  
  const icalToken = db.prepare('SELECT propertyId FROM ical_tokens WHERE token = ?').get(token);
  if (!icalToken) {
    return res.status(404).json({ error: 'Token introuvable' });
  }
  
  try {
    const icalData = db.exportPropertyAsIcal(icalToken.propertyId);
    if (!icalData) {
      return res.status(404).json({ error: 'Propriété introuvable' });
    }
    
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
    res.send(icalData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Regenerate token for a property
router.post('/regenerate-token/:propertyId', (req, res) => {
  const propertyId = Number(req.params.propertyId);
  
  const property = db.prepare('SELECT id FROM properties WHERE id = ?').get(propertyId);
  if (!property) {
    return res.status(404).json({ error: 'Propriété introuvable' });
  }
  
  try {
    const crypto = require('crypto');
    const newToken = crypto.randomBytes(32).toString('hex');
    
    // Delete old token and create new one
    db.prepare('DELETE FROM ical_tokens WHERE propertyId = ?').run(propertyId);
    db.prepare('INSERT INTO ical_tokens (propertyId, token) VALUES (?, ?)').run(propertyId, newToken);
    
    res.json({ 
      token: newToken, 
      url: `${process.env.BASE_URL || 'http://localhost:4000'}/api/ical/export/${newToken}` 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
