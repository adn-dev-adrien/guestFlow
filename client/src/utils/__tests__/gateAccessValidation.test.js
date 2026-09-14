// specs/gate-access-portier.md §3.4 — the refusals shown while typing in the « Accès portail » editors,
// the ones of specs/guest-gate-access-maquettes.html (2026-09-14).
import { describe, expect, test } from 'vitest';
import {
  GATE_ACCESS_MESSAGES, hasErrors, manualAccessErrors, stayOverridesErrors, timeWindowsError,
} from '../gateAccessValidation';

describe('time windows', () => {
  test('no window is fine: the access commands at any hour', () => {
    expect(timeWindowsError([])).toBe('');
  });
  test('an incomplete window, an end not after its start, and a window crossing midnight are refused', () => {
    expect(timeWindowsError([{ from: '08:00', until: '' }])).toBe('Plage 1 : incomplète.');
    expect(timeWindowsError([{ from: '08:00', until: '20:00' }, { from: '20:00', until: '20:00' }]))
      .toBe('Plage 2 : la fin doit venir après le début (pas de plage qui passe minuit).');
    expect(timeWindowsError([{ from: '22:00', until: '02:00' }])).toMatch(/pas de plage qui passe minuit/);
  });
  test('two overlapping windows are refused, whatever their order; touching ones are not', () => {
    expect(timeWindowsError([{ from: '12:00', until: '20:00' }, { from: '08:00', until: '13:00' }])).toBe(GATE_ACCESS_MESSAGES.windowsOverlap);
    expect(timeWindowsError([{ from: '08:00', until: '12:00' }, { from: '12:00', until: '20:00' }])).toBe('');
  });
});

describe('a hand-made access', () => {
  test('needs a name', () => {
    expect(manualAccessErrors({ label: '   ' }).label).toBe(GATE_ACCESS_MESSAGES.labelRequired);
    expect(manualAccessErrors({ label: 'Mamie' }).label).toBe('');
  });
  test('a permanent access needs no dates; a ranged one needs both, the end after the start', () => {
    expect(manualAccessErrors({ label: 'Mamie', ranged: false }).range).toBe('');
    expect(manualAccessErrors({ label: 'Mamie', ranged: true, validFrom: '2026-09-20T09:00' }).range).toBe(GATE_ACCESS_MESSAGES.rangeMissing);
    expect(manualAccessErrors({ label: 'Mamie', ranged: true, validFrom: '2026-09-20T09:00', validUntil: '2026-09-20T09:00' }).range).toBe(GATE_ACCESS_MESSAGES.rangeOrder);
    expect(hasErrors(manualAccessErrors({ label: 'Mamie', ranged: true, validFrom: '2026-09-20T09:00', validUntil: '2026-09-27T18:00' }))).toBe(false);
  });
});

describe('a stay access', () => {
  const stay = { stayFrom: '2026-09-12T16:00', stayUntil: '2026-09-14T11:00' };
  test('« Ouvrir dès » must come before the arrival, « Prolonger jusqu’au » after the stay', () => {
    expect(stayOverridesErrors({ ...stay, earlyFrom: '2026-09-12T16:00' }).early).toBe(GATE_ACCESS_MESSAGES.earlyNotBefore);
    expect(stayOverridesErrors({ ...stay, earlyFrom: '2026-09-12T13:00' }).early).toBe('');
    expect(stayOverridesErrors({ ...stay, extendedUntil: '2026-09-14T10:00' }).extended).toBe(GATE_ACCESS_MESSAGES.extendNotAfter);
    expect(stayOverridesErrors({ ...stay, extendedUntil: '2026-09-15T10:00' }).extended).toBe('');
  });
  test('both overrides are optional', () => {
    expect(hasErrors(stayOverridesErrors({ ...stay }))).toBe(false);
  });
});
