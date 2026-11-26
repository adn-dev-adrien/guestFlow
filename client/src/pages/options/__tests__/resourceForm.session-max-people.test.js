import { describe, it, expect } from 'vitest';
import { formFromResource, toResourcePayload, validateResourceForm } from '../resourceForm';

// specs/site-outside-resource-booking.md rule 25 — « Personnes par séance au plus » on a resource shown on the planning (NULL = no limit set: the site allows 20).
const banded = {
  name: 'Bain nordique', quantity: 1, price: 30, priceType: 'per_hour', isComplex: true, showsPlanningCard: true, propertyIds: [], propertyPricing: {},
  slotDuration: 60, minimumUsageMinutes: 60, openTime: '10:00', closeTime: '22:00', openDays: [1, 2, 3],
};

describe('sessionMaxPeople on the resource form', () => {
  it('is read from the stored resource, empty when it carries none', () => {
    expect(formFromResource({ ...banded, sessionMaxPeople: 8 }).sessionMaxPeople).toBe('8');
    expect(formFromResource({ ...banded, sessionMaxPeople: null }).sessionMaxPeople).toBe('');
    expect(formFromResource(banded).sessionMaxPeople).toBe('');
  });

  it('goes in the payload of a resource shown on the planning as a number, null when empty or when the resource is not banded', () => {
    expect(toResourcePayload({ ...banded, sessionMaxPeople: '8' }).sessionMaxPeople).toBe(8);
    expect(toResourcePayload({ ...banded, sessionMaxPeople: '' }).sessionMaxPeople).toBeNull();
    expect(toResourcePayload({ ...banded, showsPlanningCard: false, sessionMaxPeople: '8' }).sessionMaxPeople).toBeNull();
    expect(toResourcePayload({ ...banded, priceType: 'per_stay', sessionMaxPeople: '8' }).sessionMaxPeople).toBeNull();
  });

  it('is refused inline outside 1 to 100 whole people, like the server does', () => {
    const sentence = 'Nombre entier de personnes entre 1 et 100';
    [0, 101, '2.5', 'abc'].forEach((bad) => expect(validateResourceForm({ ...banded, sessionMaxPeople: bad }).sessionMaxPeople).toBe(sentence));
    [1, '8', 100, ''].forEach((good) => expect(validateResourceForm({ ...banded, sessionMaxPeople: good }).sessionMaxPeople).toBeUndefined());
  });
});
