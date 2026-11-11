/**
 * The guests' names of the stays a shortage impacts (specs/linen-inventory-shortage-tracking.md §4.1).
 * A read of core tables (phase 1 rule 11): the shortage alert lists the stays by guest name.
 */

function create(database) {
  return {
    findClientNamesByIds(ids) {
      const cleanIds = Array.from(new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
      if (cleanIds.length === 0) return [];
      const placeholders = cleanIds.map(() => '?').join(',');
      return database.prepare(`
        SELECT r.id, r.startDate, r.endDate, c.firstName, c.lastName
          FROM reservations r
          LEFT JOIN clients c ON c.id = r.clientId
         WHERE r.id IN (${placeholders})
      `).all(...cleanIds);
    },
  };
}

module.exports = { create };
