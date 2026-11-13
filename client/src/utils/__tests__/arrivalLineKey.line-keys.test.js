// specs/pricing-components.md §3 rule 85 — the client mirror of the server's line keys.
import { describe, it, expect } from 'vitest';
import { optionLineKey, resourceLineKey } from '../arrivalLineKey';

describe('arrivalLineKey (rule 85)', () => {
  it('keeps the legacy key for the first line of an article', () => {
    expect(optionLineKey(5)).toBe('opt:5');
    expect(optionLineKey('5', { optionId: 5 })).toBe('opt:5');
    expect(resourceLineKey(3, { resourceId: 3 })).toBe('res:3');
  });

  it('reads the line key a later sale of the same article carries', () => {
    expect(optionLineKey(5, { optionId: 5, lineId: 30, lineKey: 'line:reservation_options:30' })).toBe('line:reservation_options:30');
    expect(resourceLineKey(3, { resourceId: 3, lineKey: 'line:reservation_resources:8' })).toBe('line:reservation_resources:8');
  });
});
