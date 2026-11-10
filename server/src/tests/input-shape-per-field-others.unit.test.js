// specs/hosting-h2-account-security.md rule 68 (audit R23-A2, R23-A3) — the per-field fuzz of the routes outside the stays,
// their money and their logements (those are input-shape-per-field's): one file each so that both stay far under npm
// test's per-file cap (audit R36-S4).
const { perFieldSuite, isStayRow } = require('./inputShapePerField');

perFieldSuite({ part: (row) => !isStayRow(row), minRequests: 1000 });
