// specs/guest-app/guest-app-local-amenities.md rule 10 — a fuel place the server marks `glyph: 'charging'` is drawn with the charging
// station icon (same colour, same category label); any other fuel place keeps the pump.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PlaceSheet from '../components/PlaceSheet';
import { PLACE_STYLE, styleOf } from '../constants/placeCategories';
import { BINS } from './placesFixtures';

const FUEL = { ...BINS, category: 'carburant', categoryLabel: 'Carburant et recharge', wasteKind: null, accepts: null, energies: [{ key: 'gazole', label: 'Gazole' }] };
const badge = (place) => {
  render(<div className="app"><PlaceSheet place={place} open onClose={() => {}} /></div>);
  return document.querySelector('.pl-badge svg');
};

describe('« Pratique » — the charging station glyph (rule 10)', () => {
  it('the sheet of a charging-only place draws the charging icon', () => {
    expect(badge({ ...FUEL, glyph: 'charging', energies: [{ key: 'recharge', label: 'Recharge électrique' }] })).toHaveClass('lucide-ev-charger');
  });

  it('a place without the field keeps the pump, charging or not', () => {
    expect(badge({ ...FUEL, energies: [{ key: 'gazole', label: 'Gazole' }, { key: 'recharge', label: 'Recharge électrique' }] })).toHaveClass('lucide-fuel');
  });

  it('only the icon changes: same colour, same drawing data for the map markers', () => {
    const pump = styleOf('carburant');
    const charger = styleOf('carburant', 'charging');
    expect(charger.color).toBe(PLACE_STYLE.carburant.color);
    expect(charger.Glyph).not.toBe(pump.Glyph);
    expect(charger.data).not.toEqual(pump.data);
    expect(styleOf('boulangerie', 'charging').color).toBe(PLACE_STYLE.boulangerie.color);
  });
});
