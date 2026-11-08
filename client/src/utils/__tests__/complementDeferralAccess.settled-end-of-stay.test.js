import { complementDeferralAccess } from '../complementDeferralAccess';

// specs/defer-arrival-complement-to-checkout.md rule 23 (audit R28 verification N2) — the deferral is never switched on
// over an end-of-stay complement already collected: the control stays visible, closed, with its reason. Already on, it can
// still be switched off.

const base = {
  editingReservationId: 7, isDevisMode: false, complementAmount: 24, complementPaid: false, deferred: false, locked: false,
};

test('règle 23 — fin de séjour déjà encaissée : report fermé, avec sa raison', () => {
  expect(complementDeferralAccess({ ...base, endOfStaySettled: true })).toEqual({
    visible: true, checked: false, disabled: true, reason: 'Complément de fin de séjour déjà encaissé.', needsConfirm: false,
  });
  expect(complementDeferralAccess({ ...base, complementPaid: true, endOfStaySettled: true }).disabled).toBe(true);
});

test('règle 23 — report déjà posé : il se retire encore', () => {
  const access = complementDeferralAccess({ ...base, deferred: true, endOfStaySettled: true });
  expect([access.checked, access.disabled, access.reason]).toEqual([true, false, '']);
});

test('règle 23 — fiche verrouillée : la raison du verrou passe en premier', () => {
  expect(complementDeferralAccess({ ...base, locked: true, endOfStaySettled: true }).reason).toBe('Réservation verrouillée.');
});
