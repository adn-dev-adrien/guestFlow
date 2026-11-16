// Texts of the extra-sale screens (specs/pricing-components.md §6). The amounts and the status labels come from the server.
export const DISCOUNT_TARGETS = [
  { value: 'nights', label: 'Nuits' },
  { value: 'extras', label: 'Articles' },
  { value: 'all', label: 'Tout' },
];

// Labels of the moments the server lists per line (`saleDetail.lines[].moments`); which moments a line offers is the server's call.
export const MOMENT_LABELS = Object.freeze({
  arrival: 'À payer à l’arrivée',
  departure: 'À payer au départ',
});
