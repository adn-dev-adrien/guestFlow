import { complementDeferralAccess } from '../complementDeferralAccess';

// specs/defer-arrival-complement-to-checkout.md §3.3 rules 12-15.

const base = {
  editingReservationId: 7,
  isDevisMode: false,
  startDate: '2026-09-10',
  complementAmount: 24,
  complementPaid: false,
  deferred: false,
  locked: false,
  today: '2026-08-22',
};

test('séjour à venir, complément à percevoir → interrupteur actif et modifiable', () => {
  expect(complementDeferralAccess(base)).toEqual({ visible: true, checked: false, disabled: false, reason: '' });
});

test('marqueur déjà posé → interrupteur coché', () => {
  expect(complementDeferralAccess({ ...base, deferred: true }).checked).toBe(true);
});

test('règle 14 — pas de réservation enregistrée (création / devis) → masqué', () => {
  expect(complementDeferralAccess({ ...base, editingReservationId: null }).visible).toBe(false);
  expect(complementDeferralAccess({ ...base, isDevisMode: true }).visible).toBe(false);
});

test('complément déjà encaissé → masqué : il n\'y a plus rien à reporter', () => {
  expect(complementDeferralAccess({ ...base, complementPaid: true }).visible).toBe(false);
});

test('aucun complément → masqué, sauf si le marqueur est encore posé', () => {
  expect(complementDeferralAccess({ ...base, complementAmount: 0 }).visible).toBe(false);
  expect(complementDeferralAccess({ ...base, complementAmount: 0, deferred: true }).visible).toBe(true);
});

test('règle 15 — séjour commencé → affiché coché ET désactivé, avec le motif', () => {
  const access = complementDeferralAccess({ ...base, startDate: '2026-08-20' });
  expect(access).toMatchObject({ visible: true, checked: true, disabled: true });
  expect(access.reason).toMatch(/séjour a commencé/i);
});

test('réservation verrouillée → visible mais figé', () => {
  const access = complementDeferralAccess({ ...base, locked: true });
  expect(access).toMatchObject({ visible: true, disabled: true });
  expect(access.reason).toMatch(/verrouillée/i);
});
