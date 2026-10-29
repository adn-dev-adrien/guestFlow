// The extra-guest row hosts a chip (a div): it must not sit inside a paragraph (audit R2, finding D).
import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import PricingSummary from '../PricingSummary';

const QUOTE = {
  nights: 2, nightlyBreakdown: [], totalPrice: 600, finalPrice: 720,
  includedGuests: 2, extraGuestCount: 3, extraGuestUnitPrice: 20, extraGuestPriceUnit: 'per_night',
  extraGuestSurchargeOriginal: 120, extraGuestSurcharge: 120,
  extraGuestInBrutCount: 2, extraGuestInBrutSurcharge: 80,
  extraGuestComplementCount: 1, extraGuestComplementOriginal: 40, extraGuestComplementSurcharge: 40,
  platformPaidGuests: 4, extraGuestSurchargeOffered: false,
  optionLines: [], resourceLines: [],
};

test('the extra-guest row nests no block element in a paragraph', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { container } = render(<PricingSummary quote={QUOTE} form={{}} onToggleExtraGuestOffered={vi.fn()} />);
  expect(spy.mock.calls.filter((c) => /cannot be a descendant|validateDOMNesting/.test(String(c[0])))).toEqual([]);
  expect(container.querySelector('p div')).toBeNull();
  spy.mockRestore();
});
