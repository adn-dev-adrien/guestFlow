/**
 * Bucket boundaries of the « Profil des séjours » (specs/stay-profile.md rules 6-8). The one place
 * they are written: the model, the tests and the spec read them from here.
 *
 * Each bucket holds `max`, its inclusive upper bound (null = no bound); a value falls in the first
 * bucket whose `max` it does not exceed. Defaults chosen for two holiday rentals (mock-up of
 * 2026-11-05, `#profil`).
 *
 * Rule 26 — a number and its unit never part: a no-break space (U+00A0) joins them in every label.
 */

// Rule 6 — nights of the stay (endDate − startDate).
const LENGTH_BUCKETS = [
  { key: 'n1-2', label: '1–2\u00a0nuits', max: 2 },
  { key: 'n3-4', label: '3–4\u00a0nuits', max: 4 },
  { key: 'n5-6', label: '5–6\u00a0nuits', max: 6 },
  { key: 'n7+', label: '7\u00a0nuits et\u00a0+', max: null },
];

// Rule 7 — days from the booking day to the arrival day.
const LEAD_BUCKETS = [
  { key: 'd0-6', label: 'Moins de 7\u00a0j', max: 6 },
  { key: 'd7-30', label: '7–30\u00a0j', max: 30 },
  { key: 'd31-90', label: '1–3\u00a0mois', max: 90 },
  { key: 'd91+', label: 'Plus de 3\u00a0mois', max: null },
];
const LEAD_UNKNOWN = { key: 'unknown', label: 'Date de réservation inconnue' };

// Rule 8 — the « total de séjour », in cents so that 300,00 € and 800,00 € land exactly.
const PRICE_BUCKETS = [
  { key: 'p0-299', label: 'Moins de 300\u00a0€', max: 29999 },
  { key: 'p300-800', label: '300–800\u00a0€', max: 80000 },
  { key: 'p800+', label: 'Plus de 800\u00a0€', max: null },
];
const PRICE_UNPRICED = { key: 'unpriced', label: 'Sans montant' };

// Rule 5 — every own channel (manual, website, a platform counted as direct) is one row.
const DIRECT_CHANNEL = { key: 'direct', label: 'Direct' };

module.exports = { LENGTH_BUCKETS, LEAD_BUCKETS, LEAD_UNKNOWN, PRICE_BUCKETS, PRICE_UNPRICED, DIRECT_CHANNEL };
