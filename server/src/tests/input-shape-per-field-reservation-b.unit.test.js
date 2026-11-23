// specs/hosting-h2-account-security.md rule 68 (audit R23-A2, R23-A3) — the per-field fuzz of the whole reservation
// (`PUT /api/reservations/:id`) with the last two values (1e308, `null`); input-shape-per-field-reservation-a
// sends the others. The row alone is most of the stays' fuzz: split so that, four files at a time, each file stays far
// under npm test's per-file cap (server-test-isolation rules 15 and 24).
const { perFieldSuite, isWholeReservationRow, VALUES } = require('./inputShapePerField');

perFieldSuite({ part: isWholeReservationRow, values: VALUES.slice(3), minRequests: 600 });
