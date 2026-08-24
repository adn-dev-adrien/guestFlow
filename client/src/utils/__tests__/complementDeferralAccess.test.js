import { complementDeferralAccess } from '../complementDeferralAccess';

// specs/defer-arrival-complement-to-checkout.md §3.3 rules 12-15 — c'est l'opérateur qui décide,
// tout le temps : ni le calendrier ni l'encaissement ne retirent le contrôle.

const base = {
  editingReservationId: 7,
  isDevisMode: false,
  complementAmount: 24,
  complementPaid: false,
  deferred: false,
  locked: false,
};

test('complément à percevoir → contrôle actif et modifiable', () => {
  expect(complementDeferralAccess(base)).toEqual({
    visible: true, checked: false, disabled: false, reason: '', needsConfirm: false,
  });
});

test('marqueur déjà posé → contrôle actif', () => {
  expect(complementDeferralAccess({ ...base, deferred: true }).checked).toBe(true);
});

test('règle 15 — le séjour commencé ne verrouille plus rien', () => {
  // Aucune notion de date dans la règle : le calendrier ne décide plus du moment de collecte.
  expect(complementDeferralAccess(base).disabled).toBe(false);
});

test('règle 15 — un complément déjà encaissé reste reportable, avec confirmation', () => {
  const access = complementDeferralAccess({ ...base, complementPaid: true });
  expect(access).toMatchObject({ visible: true, disabled: false, needsConfirm: true });
});

test('… mais annuler un report déjà posé ne demande rien', () => {
  expect(complementDeferralAccess({ ...base, complementPaid: true, deferred: true }).needsConfirm).toBe(false);
});

test('règle 14 — pas de réservation enregistrée (création / devis) → masqué', () => {
  expect(complementDeferralAccess({ ...base, editingReservationId: null }).visible).toBe(false);
  expect(complementDeferralAccess({ ...base, isDevisMode: true }).visible).toBe(false);
});

test('aucun complément → masqué, sauf si le marqueur est encore posé', () => {
  expect(complementDeferralAccess({ ...base, complementAmount: 0 }).visible).toBe(false);
  expect(complementDeferralAccess({ ...base, complementAmount: 0, deferred: true }).visible).toBe(true);
});

test('réservation verrouillée → visible mais figé', () => {
  const access = complementDeferralAccess({ ...base, locked: true });
  expect(access).toMatchObject({ visible: true, disabled: true });
  expect(access.reason).toMatch(/verrouillée/i);
});
