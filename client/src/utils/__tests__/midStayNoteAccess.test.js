import { midStayNoteAccess } from '../midStayNoteAccess';

// specs/mid-stay-notes.md §3.5 rule 17 — la règle est partagée par la barre d'actions et le bloc
// « Encaissements en séjour ». Ce test est ce qui les empêche de diverger.

const base = {
  editingReservationId: 7,
  isDevisMode: false,
  startDate: '2026-08-05',
  notesCount: 0,
  endOfStaySettled: false,
  today: '2026-08-07',
};

test('séjour en cours → visible et actif', () => {
  expect(midStayNoteAccess(base)).toEqual({ visible: true, disabled: false, reason: '' });
});

test('séjour terminé → toujours accessible (on rattrape un oubli après le départ)', () => {
  expect(midStayNoteAccess({ ...base, startDate: '2026-07-01' }).visible).toBe(true);
});

test('séjour à venir et aucune note → masqué', () => {
  expect(midStayNoteAccess({ ...base, startDate: '2026-09-01' }).visible).toBe(false);
});

test('séjour à venir MAIS une note existe → visible, pour garder l\'historique atteignable', () => {
  const r = midStayNoteAccess({ ...base, startDate: '2026-09-01', notesCount: 1 });
  expect(r.visible).toBe(true);
  expect(r.disabled).toBe(false);
});

test('le jour même de l\'arrivée compte comme commencé', () => {
  expect(midStayNoteAccess({ ...base, startDate: '2026-08-07' }).visible).toBe(true);
});

test('création de réservation (pas encore enregistrée) → masqué', () => {
  expect(midStayNoteAccess({ ...base, editingReservationId: null }).visible).toBe(false);
});

test('devis → masqué, un devis ne vend rien sur place', () => {
  expect(midStayNoteAccess({ ...base, isDevisMode: true }).visible).toBe(false);
});

test('complément de fin de séjour encaissé → visible mais désactivé, avec la raison', () => {
  const r = midStayNoteAccess({ ...base, endOfStaySettled: true });
  expect(r.visible).toBe(true);
  expect(r.disabled).toBe(true);
  expect(r.reason).toMatch(/déjà encaissé/);
});

test('date de début absente et aucune note → masqué (pas de comparaison hasardeuse)', () => {
  expect(midStayNoteAccess({ ...base, startDate: '' }).visible).toBe(false);
});
