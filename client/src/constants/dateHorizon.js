// specs/reservations-backend-mvc.md rule 13 — no date entered outside [today − 5 years, today + 5 years],
// mirroring the server's utils/stayDates.MAX_HORIZON_YEARS and its two messages.
export const MAX_HORIZON_YEARS = 5;
export const HORIZON_MESSAGE = `Date trop lointaine : ${MAX_HORIZON_YEARS} ans au plus.`;
export const PAST_HORIZON_MESSAGE = `Date trop ancienne : ${MAX_HORIZON_YEARS} ans au plus.`;
