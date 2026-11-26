import { describe, it, expect } from 'vitest';
import { formFromResource, toResourcePayload, validateResourceForm } from '../resourceForm';

// specs/gift-vouchers/gift-voucher-campaigns.md rule 51 — a resource's booking horizon, in months (3 by default, 1 to 24).
const slotted = {
  name: 'Bain nordique', quantity: 1, price: 30, priceType: 'per_hour', isComplex: true, propertyIds: [], propertyPricing: {},
  slotDuration: 30, minimumUsageMinutes: 60, openTime: '12:00', closeTime: '22:00', openDays: [1, 2, 3],
};

describe('bookingHorizonMonths on the resource form', () => {
  it('is read from the stored resource, 3 when it carries none', () => {
    expect(formFromResource({ ...slotted, bookingHorizonMonths: 6 }).bookingHorizonMonths).toBe(6);
    expect(formFromResource(slotted).bookingHorizonMonths).toBe(3);
  });

  it('goes in the payload of a slotted resource as a number, and is back to 3 when the resource is not slotted', () => {
    expect(toResourcePayload({ ...slotted, bookingHorizonMonths: '6' }).bookingHorizonMonths).toBe(6);
    expect(toResourcePayload({ ...slotted, isComplex: false, bookingHorizonMonths: 6 }).bookingHorizonMonths).toBe(3);
    expect(toResourcePayload({ ...slotted, priceType: 'per_stay', bookingHorizonMonths: 6 }).bookingHorizonMonths).toBe(3);
  });

  it('is refused inline outside 1 to 24 whole months, like the server does', () => {
    const sentence = 'Nombre entier de mois entre 1 et 24';
    [0, 25, '1.5', ''].forEach((bad) => expect(validateResourceForm({ ...slotted, bookingHorizonMonths: bad }).bookingHorizonMonths).toBe(sentence));
    [1, 3, '24'].forEach((good) => expect(validateResourceForm({ ...slotted, bookingHorizonMonths: good }).bookingHorizonMonths).toBeUndefined());
  });
});
