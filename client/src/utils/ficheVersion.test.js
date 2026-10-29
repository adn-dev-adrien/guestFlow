// specs/reservation-fiche-concurrency.md rule 4 — the fiche adopts a new version only for its own writes.
import { describe, expect, it } from 'vitest';
import { versionAfterOwnWrite } from './ficheVersion';

const detail = (over = {}) => ({ reservationId: 7, before: 'v1', after: 'v2', ...over });

describe('versionAfterOwnWrite', () => {
  it('adopts the new version when the write started from the held one', () => {
    expect(versionAfterOwnWrite(7, 'v1', detail())).toBe('v2');
  });

  it('keeps the held version when something else wrote in between (rule 4)', () => {
    expect(versionAfterOwnWrite(7, 'v1', detail({ before: 'v-foreign' }))).toBe('v1');
  });

  it('ignores a write on another stay or one without detail', () => {
    expect(versionAfterOwnWrite(7, 'v1', detail({ reservationId: 8 }))).toBe('v1');
    expect(versionAfterOwnWrite(7, 'v1', null)).toBe('v1');
  });

  it('holds nothing until the fiche has loaded a version', () => {
    expect(versionAfterOwnWrite(7, null, detail())).toBeNull();
  });
});

describe('versionAfterOwnWrite — writes from outside the stay (rule 6)', () => {
  const stays = (...list) => ({ stays: list });

  it('adopts the version of the fiche stay in the list, ignoring the others', () => {
    expect(versionAfterOwnWrite(7, 'v1', stays(detail({ reservationId: 8, before: 'x', after: 'y' }), detail()))).toBe('v2');
  });

  it('keeps the held version when the list broke the chain or does not list the stay', () => {
    expect(versionAfterOwnWrite(7, 'v1', stays(detail({ before: 'v-foreign' })))).toBe('v1');
    expect(versionAfterOwnWrite(7, 'v1', stays(detail({ reservationId: 8 })))).toBe('v1');
  });
});
