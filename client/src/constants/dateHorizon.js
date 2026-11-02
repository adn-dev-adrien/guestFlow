// specs/reservations-backend-mvc.md rule 13 — no date entered past today + 5 years, mirroring the server's
// utils/stayDates.MAX_HORIZON_YEARS and its message.
export const MAX_HORIZON_YEARS = 5;
export const HORIZON_MESSAGE = `Date trop lointaine : ${MAX_HORIZON_YEARS} ans au plus.`;
