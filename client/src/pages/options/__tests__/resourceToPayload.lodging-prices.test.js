import { describe, it, expect } from 'vitest';
import { toResourcePayload } from '../resourceForm';

// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 4 — a price per lodging is withdrawn only for an hourly resource of the planning; one with no planning card keeps it.
const base = {
  name: 'Bain', quantity: 1, price: 30, priceType: 'per_hour', propertyIds: [], propertyPricing: { 1: { price: '12', freeMinutes: 60 } },
};

describe('toResourcePayload — price per lodging', () => {
  it('drops the price and keeps the offered hour on an hourly resource of the planning', () => {
    expect(toResourcePayload({ ...base, showsPlanningCard: true }).propertyPricing).toEqual({ 1: { price: null, freeMinutes: 60 } });
  });

  it('keeps the price per lodging of an hourly resource with no planning card', () => {
    expect(toResourcePayload({ ...base, showsPlanningCard: false }).propertyPricing).toEqual({ 1: { price: 12, freeMinutes: 60 } });
  });
});
