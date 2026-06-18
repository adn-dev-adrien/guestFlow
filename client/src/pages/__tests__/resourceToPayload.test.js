import { describe, it, expect } from 'vitest';
import { toResourcePayload } from '../ResourcesPage';

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
});
