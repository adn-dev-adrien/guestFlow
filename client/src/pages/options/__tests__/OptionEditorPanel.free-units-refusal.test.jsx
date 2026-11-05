// specs/tariff-recipes/spec.md rule 69, reading of 2026-11-05 (audit R24 verification DB-1) — a save that would drop a
// property's free units is refused on that row's price; with a price type that has no « Prix » column (« Gratuit »,
// « Dégressif participants ») the refusal prints under the property's row, never hidden behind « 1 champ à corriger ».
import React from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../../api';
import { renderEditor, storedOption } from './optionEditorFixtures';

vi.mock('../../../api', () => ({
  default: { getOption: vi.fn(), createOption: vi.fn(), updateOption: vi.fn(), getOptionPropertyDefaults: vi.fn() },
}));
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  api.updateOption.mockRejectedValue(Object.assign(new Error('VALIDATION_FAILED'), {
    status: 422, details: [{ field: 'propertyPrices.2', message: 'Prix requis : unités offertes' }],
  }));
});

for (const [label, priceType] of [['Gratuit', 'free'], ['Dégressif participants', 'per_participant_progressive']]) {
  test(`rule 69: « ${label} » — the free-units refusal shows under the property's row`, async () => {
    const user = userEvent.setup();
    api.getOption.mockResolvedValue(storedOption({ priceType, price: priceType === 'free' ? 0 : 10 }));
    renderEditor();
    await screen.findByRole('heading', { name: 'Ménage' });
    expect(screen.queryByLabelText('Prix · Estiva')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Description/), '!');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    const row = await screen.findByRole('group', { name: 'Estiva' });
    expect(await within(row).findByText('Prix requis : unités offertes')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Granja' })).queryByText('Prix requis : unités offertes')).not.toBeInTheDocument();
  });
}
