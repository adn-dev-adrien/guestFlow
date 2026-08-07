/**
 * Headings of the three complement buckets — specs/complement-buckets-by-moment.md §3 rule 7.
 *
 * A complement is named after the MOMENT it is collected, not the column that stores it. Shared by
 * the summary panel and the Finance cards so the same amount can never read under two headings on
 * the same page. The amounts themselves come from the server (`quote.complementSplit`).
 */
export const COMPLEMENT_LABELS = {
  arrival: "Complément d'arrivée",
  duringStay: 'Complément durant le séjour',
  endOfStay: 'Complément de fin de séjour',
};

// Same three moments, phrased as the « dont … » breakdown lines of the summary panel.
export const COMPLEMENT_BREAKDOWN_LABELS = {
  arrival: "dont complément d'arrivée",
  duringStay: 'dont complément durant le séjour',
  endOfStay: 'dont complément de fin de séjour',
};
