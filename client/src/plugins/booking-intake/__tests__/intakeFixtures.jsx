// Shared fixtures of the Saisie Booking suites — the block GET /api/booking-intake/reservation/:id returns,
// and the lines GET /api/booking-intake/pending returns.
export const APPLIED = {
  id: 4,
  status: 'applied',
  resId: '6300000001',
  appliedLabel: '15/10 à 15:52',
  differences: [],
  guestMessagePending: false,
};

export const PROPOSED = {
  id: 5,
  status: 'proposed',
  resId: '6300000001',
  appliedLabel: '15/10 à 15:52',
  differences: [
    { field: 'adults', label: 'Adultes', from: 8, to: 10 },
    { field: 'platformPayoutAmount', label: 'Virement reçu', from: null, to: 606.44 },
    { field: 'email', label: 'E-mail', from: 'c@x.fr', to: 'csierra.123456@guest.booking.com' },
  ],
  guestMessagePending: false,
};

export const PENDING = [
  { reservationId: 22309, propertyName: 'La Granja', startDate: '2026-10-19', endDate: '2026-10-21', daysToArrival: 3, urgent: true,
    extranetUrl: 'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/search_reservations.html?hotel_id=14407976&date_type=arrival&date_from=2026-10-19&date_to=2026-10-19' },
  { reservationId: 22310, propertyName: 'La Granja', startDate: '2026-12-01', endDate: '2026-12-03', daysToArrival: 46, urgent: false,
    extranetUrl: 'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/search_reservations.html?hotel_id=14407976&date_type=arrival&date_from=2026-12-01&date_to=2026-12-01' },
];
