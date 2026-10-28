// Shared payloads for the Clients page suites: the shape `GET /api/clients/directory` answers
// (specs/clients-upcoming-past-directory.md §4.3, amendment of 2026-10-28).

export function directoryClient(over = {}) {
  return {
    id: 1,
    lastName: 'Dupont',
    firstName: 'Jean',
    email: '',
    phone: '',
    postalCode: '',
    city: '',
    bucket: 'upcoming',
    stayDate: '2026-11-06',
    stay: {
      reservationId: 10, propertyName: 'La Granja', startDate: '2026-11-06', endDate: '2026-11-08', nights: 2, platform: 'Booking',
    },
    stayCount: 1,
    whenLabel: 'Arrive dans 9 j',
    ...over,
  };
}

export function directoryPayload({
  view = 'upcoming', groups = [], counts, orphanCount = 0, elsewhere = null,
} = {}) {
  const items = groups.flatMap((g) => g.items);
  return {
    view,
    sort: 'stayDate',
    dir: 'asc',
    counts: counts || { upcoming: view === 'upcoming' ? items.length : 0, past: view === 'past' ? items.length : 0, none: view === 'none' ? items.length : 0 },
    orphanCount,
    elsewhere,
    groups: groups.map((g) => ({ count: g.items.length, ...g })),
    items,
  };
}

export const oneGroup = (items, label = '7 prochains jours', key = 'next7') => ({ key, label, items });
