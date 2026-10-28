import { describe, it, expect } from 'vitest';
import { toResourcePayload, validateResourceForm, withScope } from '../resourceForm';

// specs/resource-hourly-scheduling.md §3.1 — the catalog save must carry the hourly scheduling fields
// (regression: toPayload dropped them, so « Planification par séances » was never persisted).
const base = {
  name: 'Bain nordique', quantity: 1, price: 30, priceType: 'per_hour', isComplex: true,
  propertyIds: [], propertyPricing: {}, slotDuration: 30, minimumUsageMinutes: 60,
  openTime: '12:00', closeTime: '22:00', openDays: [1, 2, 3], turnoverMinutes: 0,
};

describe('toResourcePayload — hourly scheduling fields', () => {
  it('includes the planning + grid fields when per_hour + planification enabled', () => {
    const p = toResourcePayload({
      ...base,
      showsPlanningCard: true, hourlyEveningStart: '20:00', hourlyEveningRate: 50,
      hourlyExternalDayRate: 40, hourlyExternalEveningRate: 60,
    });
    expect(p.showsPlanningCard).toBe(1);
    expect(p.hourlyEveningStart).toBe('20:00');
    expect(p.hourlyEveningRate).toBe(50);
    expect(p.hourlyExternalDayRate).toBe(40);
    expect(p.hourlyExternalEveningRate).toBe(60);
  });

  it('clears the planning fields when planification is off', () => {
    const p = toResourcePayload({ ...base, showsPlanningCard: false, hourlyEveningStart: '20:00', hourlyEveningRate: 50 });
    expect(p.showsPlanningCard).toBe(0);
    expect(p.hourlyEveningStart).toBe(null);
    expect(p.hourlyEveningRate).toBe(0);
  });

  it('clears the planning flag when the resource is not per_hour (even if the toggle lingered)', () => {
    const p = toResourcePayload({ ...base, priceType: 'per_stay', showsPlanningCard: true, hourlyEveningRate: 50 });
    expect(p.showsPlanningCard).toBe(0);
    expect(p.hourlyEveningRate).toBe(0);
  });

  // specs/hourly-resource-quantity-and-sas-scheduling.md §3.3 rule 11 — the thermal model.
  describe('thermal settings', () => {
    it('carries the warm-up and the retention window on a per_hour resource', () => {
      const p = toResourcePayload({ ...base, heatUpMinutes: 240, heatRetentionMinutes: 480 });
      expect(p.heatUpMinutes).toBe(240);
      expect(p.heatRetentionMinutes).toBe(480);
    });

    it('defaults both to 0, which reproduces the pre-thermal availability', () => {
      const p = toResourcePayload(base);
      expect(p.heatUpMinutes).toBe(0);
      expect(p.heatRetentionMinutes).toBe(0);
    });

    it('clamps negatives — a negative warm-up would open slots in the past', () => {
      const p = toResourcePayload({ ...base, heatUpMinutes: -60, heatRetentionMinutes: -1 });
      expect(p.heatUpMinutes).toBe(0);
      expect(p.heatRetentionMinutes).toBe(0);
    });

    it('clears both when the resource is not per_hour', () => {
      const p = toResourcePayload({ ...base, priceType: 'per_stay', heatUpMinutes: 240, heatRetentionMinutes: 480 });
      expect(p.heatUpMinutes).toBe(0);
      expect(p.heatRetentionMinutes).toBe(0);
    });
  });
});

// specs/options-resources-ux.md rules 21, 28 — price lines follow the resource's scope; a blank price is null.
describe('toResourcePayload — property price lines', () => {
  const line = (price, freeMinutes = 0) => ({ price, freeMinutes });

  it('sends a blank price as null (inherit) and a typed one as a number, comma accepted', () => {
    const p = toResourcePayload({ ...base, propertyPricing: { 1: line('', 60), 2: line('12,5') } });
    expect(p.propertyPricing).toEqual({ 1: { price: null, freeMinutes: 60 }, 2: { price: 12.5, freeMinutes: 0 } });
  });

  it('drops a line with neither a price nor a free hour', () => {
    expect(toResourcePayload({ ...base, propertyPricing: { 1: line('', 0) } }).propertyPricing).toEqual({});
  });

  it('does not send the lines of properties outside an explicit scope', () => {
    const p = toResourcePayload({ ...base, propertyIds: [1], propertyPricing: { 1: line('5'), 2: line('9') } });
    expect(p.propertyPricing).toEqual({ 1: { price: 5, freeMinutes: 0 } });
  });

  it('does not judge a line outside the scope; an invalid one inside is an error', () => {
    const form = { ...base, quantity: '1', price: '30', propertyIds: [1], propertyPricing: { 1: line('x'), 2: line('-3') } };
    expect(validateResourceForm(form)).toEqual({ 'propertyPricing.1': 'Nombre attendu' });
    expect(validateResourceForm({ ...form, propertyIds: [2] })).toEqual({ 'propertyPricing.2': 'Positif ou nul' });
  });

  it('withScope drops the lines of the properties that left the scope; an empty scope (all) keeps them', () => {
    const form = { ...base, propertyIds: [], propertyPricing: { 1: line('5'), 2: line('9') } };
    expect(Object.keys(withScope(form, [2]).propertyPricing)).toEqual(['2']);
    expect(Object.keys(withScope(form, []).propertyPricing)).toEqual(['1', '2']);
  });
});
