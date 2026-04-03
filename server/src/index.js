const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Serve uploads
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Routes
app.use('/api/clients', require('./routes/clients'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/options', require('./routes/options'));
app.use('/api/resources', require('./routes/resources'));
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/school-holidays', require('./routes/schoolHolidays'));
app.use('/api/calendar-notes', require('./routes/calendarNotes'));

// In production, serve the built React app for non-API routes.
const clientBuildDir = path.join(__dirname, '..', '..', 'client', 'build');
const clientIndexPath = path.join(clientBuildDir, 'index.html');
if (fs.existsSync(clientIndexPath)) {
  app.use(express.static(clientBuildDir));
  app.get(/^\/(?!api|uploads).*/, (req, res) => {
    res.sendFile(clientIndexPath);
  });
}

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`GuestFlow API running on http://localhost:${PORT}`));
