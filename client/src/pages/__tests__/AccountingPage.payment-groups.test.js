// specs/single-payment-at-check-in.md §3.3 rule 13 — folding the entries of ONE collection into one
// card. Pure function, so this is a plain unit test: what matters is that the ventilation survives
// (every entry still there, in order) and that a group of one never frames a lone payment.
import { describe, test, expect } from 'vitest';
import { groupEntries } from '../AccountingPage';

const entry = (over = {}) => ({
  reservationId: 1, kind: 'balance', paidDate: '2026-08-15', ...over,
});
const GROUP = { id: '1:2026-08-15', at: '2026-08-15', cash: false, total: 250 };

describe('groupEntries', () => {
  test('two entries of one collection become one block, both kept', () => {
    const blocks = groupEntries([
      entry({ kind: 'balance', paymentGroup: GROUP }),
      entry({ kind: 'complement', paymentGroup: GROUP }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].group).toEqual(GROUP);
    expect(blocks[0].entries.map((e) => e.kind)).toEqual(['balance', 'complement']);
  });

  test('ungrouped entries stay one card each, in order', () => {
    const blocks = groupEntries([entry({ kind: 'deposit' }), entry({ kind: 'balance' })]);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.group === null)).toBe(true);
  });

  test('a group left with a single entry reads as an ordinary payment', () => {
    // The other bucket fell in another month, or was dropped as a pure-tax entry.
    const blocks = groupEntries([entry({ kind: 'balance', paymentGroup: GROUP })]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].group).toBeNull();
    expect(blocks[0].entries).toHaveLength(1);
  });

  test('a grouped collection does not swallow its neighbours', () => {
    const other = entry({ reservationId: 2, kind: 'deposit', paidDate: '2026-08-20' });
    const blocks = groupEntries([
      entry({ kind: 'balance', paymentGroup: GROUP }),
      other,
      entry({ kind: 'complement', paymentGroup: GROUP }),
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].entries).toHaveLength(2);
    expect(blocks[1].entries).toEqual([other]);
  });

  test('the réduction and the pourboire of a payment join ITS card', () => {
    // specs/arrival-payment-detail-and-adjustment.md rule 26 — l'ajustement appartient à la collecte
    // qu'il corrige : il se lit sous les seaux, pas dans une carte orpheline à l'autre bout du mois.
    const blocks = groupEntries([
      entry({ kind: 'balance', paymentGroup: GROUP }),
      entry({ kind: 'complement', paymentGroup: GROUP }),
      entry({ kind: 'discount', direction: 'discount', paymentGroup: GROUP }),
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].entries.map((e) => e.kind)).toEqual(['balance', 'complement', 'discount']);
  });

  test('two different collections are two blocks', () => {
    const g2 = { ...GROUP, id: '2:2026-08-16' };
    const blocks = groupEntries([
      entry({ kind: 'balance', paymentGroup: GROUP }),
      entry({ kind: 'complement', paymentGroup: GROUP }),
      entry({ reservationId: 2, kind: 'balance', paymentGroup: g2 }),
      entry({ reservationId: 2, kind: 'complement', paymentGroup: g2 }),
    ]);
    expect(blocks.map((b) => b.group.id)).toEqual([GROUP.id, g2.id]);
  });
});
