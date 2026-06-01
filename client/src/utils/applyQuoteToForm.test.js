/* eslint-env jest */
const { applyQuoteToForm } = require('./applyQuoteToForm');

// Regression tests for the live-recompute → form-sync helper. The critical contract is:
//   the user's local `inComplement` toggle on options / customOptions / resources MUST
//   survive the next round of `setForm(prev => applyQuoteToForm(prev, quote))`. Otherwise
//   every keystroke that triggers a pricing recompute snaps the chip back to off (bug
//   reported 2026-06-01, see specs/force-item-to-complement.md §3.1).

const baseQuote = {
  totalPrice: 200,
  finalPrice: 200,
  touristTaxRate: 0,
  touristTaxTotal: 0,
  depositAmount: 60,
  depositDueDate: '2026-07-01',
  balanceAmount: 140,
  balanceDueDate: '2026-07-08',
  optionLines: [],
  resourceLines: [],
};

const basePrev = {
  customPrice: '',
  selectedOptions: [],
  customOptions: [],
  selectedResources: [],
};

describe('applyQuoteToForm — inComplement preservation', () => {
  test('preserves prev.selectedOptions[i].inComplement when the engine returns 0', () => {
    // User just toggled Compl. on locally → prev.inComplement = true. Server quote
    // hasn't received the flag yet (race) and returns inComplement = 0. The helper
    // MUST keep the user's local true.
    const prev = {
      ...basePrev,
      selectedOptions: [{ optionId: 10, quantity: 1, inComplement: true }],
    };
    const quote = {
      ...baseQuote,
      optionLines: [{ optionId: 10, quantity: 1, totalPrice: 50, offered: 0, inComplement: 0 }],
    };
    const next = applyQuoteToForm(prev, quote);
    expect(next.selectedOptions).toHaveLength(1);
    expect(next.selectedOptions[0].inComplement).toBe(true);
  });

  test('preserves prev.selectedOptions[i].inComplement = false even when engine returns 1', () => {
    // Symmetric: user un-toggled → engine still has stale forced state. Local wins.
    const prev = {
      ...basePrev,
      selectedOptions: [{ optionId: 10, quantity: 1, inComplement: false }],
    };
    const quote = {
      ...baseQuote,
      optionLines: [{ optionId: 10, quantity: 1, totalPrice: 50, offered: 0, inComplement: 1 }],
    };
    const next = applyQuoteToForm(prev, quote);
    expect(next.selectedOptions[0].inComplement).toBe(false);
  });

  test('falls back to engine value when the option is new (initial load case)', () => {
    // Line is in the quote but not in prev → no local override → use engine value.
    const prev = { ...basePrev, selectedOptions: [] };
    const quote = {
      ...baseQuote,
      optionLines: [{ optionId: 99, quantity: 1, totalPrice: 50, offered: 0, inComplement: 1 }],
    };
    const next = applyQuoteToForm(prev, quote);
    expect(next.selectedOptions[0].inComplement).toBe(true);
  });

  test('preserves custom option inComplement matched by customKey', () => {
    const prev = {
      ...basePrev,
      customOptions: [{ customKey: 'custom_1', description: 'Ménage', amount: 40, inComplement: true }],
    };
    const quote = {
      ...baseQuote,
      optionLines: [{
        isCustom: true, customKey: 'custom_1', title: 'Ménage',
        totalPrice: 40, originalTotalPrice: 40, offered: 0, inComplement: 0,
      }],
    };
    const next = applyQuoteToForm(prev, quote);
    expect(next.customOptions).toHaveLength(1);
    expect(next.customOptions[0].inComplement).toBe(true);
    expect(next.customOptions[0].customKey).toBe('custom_1');
  });

  test('preserves resource inComplement matched by resourceId', () => {
    const prev = {
      ...basePrev,
      selectedResources: [{ resourceId: 20, quantity: 1, inComplement: true }],
    };
    const quote = {
      ...baseQuote,
      resourceLines: [{
        resourceId: 20, quantity: 1, unitPrice: 30, totalPrice: 30, offered: 0, inComplement: 0,
      }],
    };
    const next = applyQuoteToForm(prev, quote);
    expect(next.selectedResources).toHaveLength(1);
    expect(next.selectedResources[0].inComplement).toBe(true);
  });

  test('multiple rapid toggles: prev wins even when the engine lags behind', () => {
    // Simulates two quick toggles. After click #1, recompute fires. Before it returns,
    // user clicks again (#2 → off). The recompute returning inComplement=1 from the
    // engine's perspective must NOT override the now-false local state.
    const afterFirstClick = applyQuoteToForm(
      { ...basePrev, selectedOptions: [{ optionId: 10, quantity: 1, inComplement: true }] },
      { ...baseQuote, optionLines: [{ optionId: 10, quantity: 1, totalPrice: 50, offered: 0, inComplement: 0 }] },
    );
    expect(afterFirstClick.selectedOptions[0].inComplement).toBe(true);

    // Now user clicks again → local becomes false. Next recompute returns inComplement=1.
    const localAfterSecondClick = {
      ...afterFirstClick,
      selectedOptions: afterFirstClick.selectedOptions.map((s) => ({ ...s, inComplement: false })),
    };
    const afterSecondClick = applyQuoteToForm(
      localAfterSecondClick,
      { ...baseQuote, optionLines: [{ optionId: 10, quantity: 1, totalPrice: 50, offered: 0, inComplement: 1 }] },
    );
    expect(afterSecondClick.selectedOptions[0].inComplement).toBe(false);
  });

  test('preserves per-line contribs from the quote (snapshot data)', () => {
    // Contribs are server-owned (captured at payment flip) — the helper just surfaces them.
    const prev = { ...basePrev, selectedOptions: [{ optionId: 10, quantity: 1 }] };
    const quote = {
      ...baseQuote,
      optionLines: [{
        optionId: 10, quantity: 1, totalPrice: 50, offered: 0, inComplement: 0,
        acompteContribTtc: 15, soldeContribTtc: 35,
      }],
    };
    const next = applyQuoteToForm(prev, quote);
    expect(next.selectedOptions[0].acompteContribTtc).toBe(15);
    expect(next.selectedOptions[0].soldeContribTtc).toBe(35);
  });

  test('null contribs from the quote become null on the form (not undefined)', () => {
    const prev = { ...basePrev, selectedOptions: [{ optionId: 10, quantity: 1 }] };
    const quote = {
      ...baseQuote,
      optionLines: [{
        optionId: 10, quantity: 1, totalPrice: 50, offered: 0, inComplement: 0,
        acompteContribTtc: null, soldeContribTtc: null,
      }],
    };
    const next = applyQuoteToForm(prev, quote);
    expect(next.selectedOptions[0].acompteContribTtc).toBeNull();
    expect(next.selectedOptions[0].soldeContribTtc).toBeNull();
  });
});

describe('applyQuoteToForm — basic shaping', () => {
  test('writes deposit/balance amounts and dates from the quote', () => {
    const next = applyQuoteToForm(basePrev, baseQuote);
    expect(next.depositAmount).toBe(60);
    expect(next.depositDueDate).toBe('2026-07-01');
    expect(next.balanceAmount).toBe(140);
    expect(next.balanceDueDate).toBe('2026-07-08');
    expect(next.touristTaxTotal).toBe(0);
  });

  test('finalPrice tracks the engine when customPrice is empty', () => {
    const next = applyQuoteToForm(basePrev, { ...baseQuote, finalPrice: 250 });
    expect(next.finalPrice).toBe(250);
  });

  test('finalPrice is preserved from prev.customPrice when the user has set a manual price', () => {
    const next = applyQuoteToForm({ ...basePrev, customPrice: 175 }, baseQuote);
    expect(next.finalPrice).toBe(175);
  });

  test('blank totalPrice from the engine maps to empty string (iCal-imported reservations)', () => {
    const next = applyQuoteToForm(basePrev, { ...baseQuote, totalPrice: null, finalPrice: null });
    expect(next.totalPrice).toBe('');
    expect(next.finalPrice).toBe('');
  });

  test('does not mutate the previous form object', () => {
    const prev = { ...basePrev, selectedOptions: [{ optionId: 10, quantity: 1, inComplement: true }] };
    const frozen = { ...prev, selectedOptions: [...prev.selectedOptions] };
    applyQuoteToForm(prev, {
      ...baseQuote,
      optionLines: [{ optionId: 10, quantity: 2, totalPrice: 100, offered: 0, inComplement: 0 }],
    });
    expect(prev.selectedOptions[0].quantity).toBe(frozen.selectedOptions[0].quantity);
    expect(prev.selectedOptions[0].inComplement).toBe(true);
  });
});
