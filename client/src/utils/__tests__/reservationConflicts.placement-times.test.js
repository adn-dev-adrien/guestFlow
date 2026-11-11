// specs/edit-reservation-blocked-by-overlap.md rule 5 (spec review 2026-10-27) — a check-in / check-out
// time change on an existing fiche is a placement change: the overlap check runs again.
import { describe, it, expect } from 'vitest';
import { isPlacementUnchanged } from '../reservationConflicts';

const loadedForm = { startDate: '2026-12-10', endDate: '2026-12-13', checkInTime: '16:00', checkOutTime: '10:00' };

describe('isPlacementUnchanged', () => {
  it('is unchanged when logement, dates and times are the loaded ones', () => {
    expect(isPlacementUnchanged({ loadedProp: 1, loadedForm, selectedProp: '1', form: { ...loadedForm } })).toBe(true);
  });

  it('sees a departure moved to 18:00 as a placement change', () => {
    expect(isPlacementUnchanged({ loadedProp: 1, loadedForm, selectedProp: 1, form: { ...loadedForm, checkOutTime: '18:00' } })).toBe(false);
  });

  it('sees an earlier arrival as a placement change', () => {
    expect(isPlacementUnchanged({ loadedProp: 1, loadedForm, selectedProp: 1, form: { ...loadedForm, checkInTime: '12:00' } })).toBe(false);
  });

  it('still sees a date or logement change', () => {
    expect(isPlacementUnchanged({ loadedProp: 1, loadedForm, selectedProp: 1, form: { ...loadedForm, endDate: '2026-12-14' } })).toBe(false);
    expect(isPlacementUnchanged({ loadedProp: 1, loadedForm, selectedProp: 2, form: { ...loadedForm } })).toBe(false);
  });

  it('has nothing to compare on a new fiche', () => {
    expect(isPlacementUnchanged({ loadedProp: null, loadedForm: null, selectedProp: 1, form: loadedForm })).toBe(false);
  });
});
