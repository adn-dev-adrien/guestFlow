// specs/guest-app.md rules 27bis, 41 — the breakfast's hour is one of the delivery times the server offers: a
// default the times no longer offer gives way to the first one, a single hour is stated, and a morning where
// the hour is not a delivery time says so in the guest's language.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BreakfastSheet from '../components/BreakfastSheet';
import { LangContext } from '../i18n';
import { stubApi } from './guestFixtures';

const ITEM = {
  kind: 'breakfast',
  id: 3,
  title: 'Petit-déjeuner',
  priceLabel: '12 €',
  priceUnitLabel: 'par personne',
  needsStaff: true,
  defaultTime: '08:00',
  maxQuantity: 4,
  mornings: [{ date: '2099-07-07', label: 'mar. 7 juil.' }, { date: '2099-07-08', label: 'mer. 8 juil.' }],
};
const at = (date, hhmm) => `${date}T${hhmm}:00+02:00`;
const QUOTE = (body) => ({ lines: body.lines, total: 24, totalLabel: '24 €' });

function renderSheet(lang = 'fr') {
  return render(
    <LangContext.Provider value={lang}>
      <BreakfastSheet item={ITEM} partySize={2} open onClose={vi.fn()} onAdd={vi.fn()} />
    </LangContext.Provider>,
  );
}

describe('BreakfastSheet — the hour (rules 27bis, 41)', () => {
  it('a default hour the delivery times no longer offer gives way to the one offered, stated, and the mornings stay open', async () => {
    stubApi({
      'POST /shop/delivery-slots': { needed: true, days: [{ slots: [{ at: at('2099-07-07', '09:30') }] }, { slots: [{ at: at('2099-07-08', '09:30') }] }] },
      'POST /orders/quote': QUOTE,
    });
    renderSheet();
    expect(await screen.findByText('9 h 30')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/pas à/)).toBeNull());
    expect(screen.getByRole('button', { name: 'mar. 7 juil.' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Ajouter/ })).toBeEnabled());
  });

  it('a morning where the hour is not a delivery time says so, in English too', async () => {
    stubApi({
      'POST /shop/delivery-slots': { needed: true, days: [{ slots: [{ at: at('2099-07-07', '08:00') }] }, { slots: [{ at: at('2099-07-08', '09:00') }] }] },
      'POST /orders/quote': QUOTE,
    });
    renderSheet('en');
    expect(await screen.findByRole('button', { name: 'mer. 8 juil. · not at 08:00' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('group', { name: 'At what time?' })).toBeInTheDocument();
  });
});
