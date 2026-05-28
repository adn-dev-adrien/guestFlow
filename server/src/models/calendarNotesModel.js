// Calendar notes model — per-property, per-date short notes shown on the calendar.

const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');

const MAX_NOTE_LENGTH = 50;

function createCalendarNotesModel(database) {
  return {
    MAX_NOTE_LENGTH,

    listForProperty(propertyId, { from, to } = {}) {
      if (from && to) {
        return database.prepare('SELECT * FROM calendar_notes WHERE propertyId = ? AND date >= ? AND date <= ?').all(propertyId, from, to);
      }
      return database.prepare('SELECT * FROM calendar_notes WHERE propertyId = ?').all(propertyId);
    },

    // Upsert; an empty note deletes the row. Returns the saved row, or { deleted: true }.
    upsert(propertyId, date, rawNote) {
      const note = sentenceCase(rawNote || '').slice(0, MAX_NOTE_LENGTH);
      if (!note.trim()) {
        database.prepare('DELETE FROM calendar_notes WHERE propertyId = ? AND date = ?').run(propertyId, date);
        return { deleted: true };
      }
      database.prepare(`
        INSERT INTO calendar_notes (propertyId, date, note) VALUES (?, ?, ?)
        ON CONFLICT(propertyId, date) DO UPDATE SET note = excluded.note
      `).run(propertyId, date, note.trim());
      return database.prepare('SELECT * FROM calendar_notes WHERE propertyId = ? AND date = ?').get(propertyId, date);
    },

    remove(propertyId, date) {
      database.prepare('DELETE FROM calendar_notes WHERE propertyId = ? AND date = ?').run(propertyId, date);
      return { deleted: true };
    },
  };
}

const defaultModel = createCalendarNotesModel(db);
defaultModel.buildModel = createCalendarNotesModel;

module.exports = defaultModel;
