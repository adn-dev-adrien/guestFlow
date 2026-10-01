// specs/single-payment-at-check-in.md §3.3 rule 13 — le tableau « Encaissements du mois » montre UNE
// ligne par collecte, pas une par échéance.
//
// La règle était écrite depuis la v2.9.0 mais jamais construite : les cartes de journal regroupaient
// bien les écritures d'un paiement unique, pendant que le tableau juste en dessous en listait deux.
// L'opérateur lisait donc deux versements là où le relevé bancaire n'en porte qu'un — signalé en
// production le 2026-09-01 sur les réservations 22281 (281,98 €) et 12 (27 €).
import { describe, test, expect } from 'vitest';
import { groupPreviewRows } from '../AccountingPage';

const GROUP = { id: '22281:2026-08-31', at: '2026-08-31', cash: false, total: 281.98 };

const row = (over = {}) => ({
  reservationId: 22281, propertyName: 'Aventura lodge', client: 'Harmen Van dijk',
  platform: 'direct', date: '2026-08-31', kind: 'balance',
  encaissement: 231.98, net: 231.98, commission: null, paymentGroup: null,
  ...over,
});

describe('groupPreviewRows', () => {
  test('les deux échéances d’une même collecte deviennent UNE ligne', () => {
    const blocks = groupPreviewRows([
      row({ kind: 'balance', encaissement: 231.98, net: 231.98, paymentGroup: GROUP }),
      row({ kind: 'endOfStayComplement', encaissement: 50, net: 50, paymentGroup: GROUP }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].group).toEqual(GROUP);
    // Les deux restent atteignables : la ventilation comptable, elle, n'a pas fusionné.
    expect(blocks[0].rows.map((r) => r.kind)).toEqual(['balance', 'endOfStayComplement']);
  });

  test('les encaissements sans groupe gardent une ligne chacun, dans l’ordre', () => {
    const blocks = groupPreviewRows([row({ kind: 'deposit' }), row({ kind: 'balance' })]);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.group === null)).toBe(true);
  });

  test('un groupe réduit à une seule ligne redevient un encaissement ordinaire', () => {
    // L'autre échéance est tombée dans un autre mois, ou n'a produit aucune écriture : appeler ça
    // « paiement unique » annoncerait un regroupement qui n'en est pas un.
    const blocks = groupPreviewRows([row({ paymentGroup: GROUP })]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].group).toBeNull();
  });

  test('une collecte groupée n’avale pas ses voisines', () => {
    const autre = row({ reservationId: 99, kind: 'deposit', paymentGroup: null });
    const blocks = groupPreviewRows([
      row({ kind: 'balance', paymentGroup: GROUP }),
      autre,
      row({ kind: 'endOfStayComplement', paymentGroup: GROUP }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].rows).toHaveLength(2);
    expect(blocks[1].rows).toEqual([autre]);
  });

  test('deux collectes différentes font deux lignes', () => {
    const g2 = { ...GROUP, id: '12:2026-08-31', total: 27 };
    const blocks = groupPreviewRows([
      row({ kind: 'balance', paymentGroup: GROUP }),
      row({ kind: 'endOfStayComplement', paymentGroup: GROUP }),
      row({ reservationId: 12, kind: 'complement', paymentGroup: g2 }),
      row({ reservationId: 12, kind: 'endOfStayComplement', paymentGroup: g2 }),
    ]);
    expect(blocks.map((b) => b.group.id)).toEqual([GROUP.id, g2.id]);
  });

  test('une charge utile d’avant la règle (aucun paymentGroup) passe sans rien changer', () => {
    const rows = [row({ kind: 'deposit' }), row({ kind: 'balance' }), row({ kind: 'complement' })];
    expect(groupPreviewRows(rows).map((b) => b.rows[0])).toEqual(rows);
  });
});
