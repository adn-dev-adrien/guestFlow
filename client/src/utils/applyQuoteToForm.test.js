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

// Regression coverage for the devis PDF bug fix bundle (PR #112,
// `specs/devis-pdf-and-tourist-tax-fixes.md`). The PDF is server-rendered, but the
// same "consume the engine quote, never recompute on the client" contract holds
// here: when the engine returns a fresh `touristTaxTotal`, `applyQuoteToForm` MUST
// overwrite the form's stale value. The bug-equivalent on the client would be the
// helper preserving `prev.touristTaxTotal` and letting it drift below the live
// engine number (= the same root cause as the PDF's stale 15,36 € vs 16,80 €).
describe('applyQuoteToForm — engine tourist tax always wins over the stale form value', () => {
  test('overwrites form.touristTaxTotal with the engine value on every recompute', () => {
    // User's exact 2026-06-04 scenario: form carries the stale 15.36€ that used to
    // leak into the PDF, engine recompute returns the live 16.80€. The next form
    // state must hold the live value — otherwise it would re-introduce the drift.
    const prev = { ...basePrev, touristTaxTotal: 15.36 };
    const next = applyQuoteToForm(prev, { ...baseQuote, touristTaxTotal: 16.80 });
    expect(next.touristTaxTotal).toBe(16.80);
  });

  test('engine zero overrides a non-zero form value (no client-side preservation)', () => {
    // E.g. switching to a platform that collects the tax → engine returns 0.
    // The form MUST follow; keeping the old number would falsely keep the tax
    // line visible in the summary AND inflate the persisted `finalPrice + tax`.
    const prev = { ...basePrev, touristTaxTotal: 6 };
    const next = applyQuoteToForm(prev, { ...baseQuote, touristTaxTotal: 0 });
    expect(next.touristTaxTotal).toBe(0);
  });

  test('engine touristTaxRate is copied verbatim — never re-derived from form fields', () => {
    // Pinning the "fat backend" boundary: the rate is engine-owned (the percentage
    // for percentage-based tax, the fixed unit otherwise). The helper just copies.
    const next = applyQuoteToForm(basePrev, { ...baseQuote, touristTaxRate: 0.05, touristTaxTotal: 16.80 });
    expect(next.touristTaxRate).toBe(0.05);
    expect(next.touristTaxTotal).toBe(16.80);
  });

  test('blank/null engine values map to 0 (no NaN leak into the form)', () => {
    // Defensive: if the engine round-trip fails and the helper receives a partial
    // quote, the form must not end up with NaN-cascading values that crash
    // PricingSummary's `.toFixed(2)` calls.
    const next = applyQuoteToForm(basePrev, { ...baseQuote, touristTaxTotal: null, touristTaxRate: undefined });
    expect(next.touristTaxTotal).toBe(0);
    expect(next.touristTaxRate).toBe(0);
  });
});
