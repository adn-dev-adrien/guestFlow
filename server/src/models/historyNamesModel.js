/**
 * Naming context for the « Historique des modifications » of a reservation / devis.
 *
 * `reservation_history` stores raw ids (option, resource, property, client); the read side resolves
 * them to names so the diff reads « Logement : Le Nid → La Grange » instead of « Logement : 3 → 5 ».
 * Kept apart from reservationsModel / devisModel because both need the exact same four maps.
 * See specs/reservation-history-granular-diff.md §4.1.
 */

function buildHistoryNameContext(database) {
  return {
    optionNames: Object.fromEntries(
      database.prepare('SELECT id, title FROM options').all().map((o) => [Number(o.id), o.title]),
    ),
    resourceNames: Object.fromEntries(
      database.prepare('SELECT id, name FROM resources').all().map((r) => [Number(r.id), r.name]),
    ),
    propertyNames: Object.fromEntries(
      database.prepare('SELECT id, name FROM properties').all().map((p) => [Number(p.id), p.name]),
    ),
    clientNames: Object.fromEntries(
      database.prepare('SELECT id, firstName, lastName FROM clients').all()
        .map((c) => [Number(c.id), `${c.firstName || ''} ${c.lastName || ''}`.trim() || `#${c.id}`]),
    ),
  };
}

module.exports = { buildHistoryNameContext };
