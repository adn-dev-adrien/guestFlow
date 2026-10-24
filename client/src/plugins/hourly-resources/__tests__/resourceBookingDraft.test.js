// specs/resource-supplements-total-server-side.md rule 9 — the draft holds the price-relevant state only.
import { describe, it, expect } from 'vitest';
import resourceBookingDraft from '../resourceBookingDraft';

const STATE = {
  resourceId: 3, bookingId: null, date: '2099-02-13', startTime: '18:00', endTime: '20:00', propertyId: '2',
};

describe('resourceBookingDraft', () => {
  it('builds the draft from the dialog state, ids as numbers', () => {
    expect(resourceBookingDraft(STATE)).toEqual({
      resourceId: 3, bookingId: null, date: '2099-02-13', startTime: '18:00', endTime: '20:00', propertyId: 2,
    });
  });

  it('carries no amount, name, phone, notes or paid flag, whatever the caller passes', () => {
    const draft = resourceBookingDraft({
      ...STATE, clientName: 'Alex', clientPhone: '0600', notes: 'x', paid: true, totalPrice: 70,
    });
    expect(Object.keys(draft).sort()).toEqual(['bookingId', 'date', 'endTime', 'propertyId', 'resourceId', 'startTime']);
  });

  it('keeps the booking being edited', () => {
    expect(resourceBookingDraft({ ...STATE, bookingId: '9' }).bookingId).toBe(9);
  });

  it('is null while the range is incomplete or not chronological', () => {
    expect(resourceBookingDraft({ ...STATE, endTime: '' })).toBeNull();
    expect(resourceBookingDraft({ ...STATE, startTime: '' })).toBeNull();
    expect(resourceBookingDraft({ ...STATE, date: '' })).toBeNull();
    expect(resourceBookingDraft({ ...STATE, startTime: '20:00', endTime: '18:00' })).toBeNull();
  });

  it('no logement is a null propertyId', () => {
    expect(resourceBookingDraft({ ...STATE, propertyId: '' }).propertyId).toBeNull();
  });
});
