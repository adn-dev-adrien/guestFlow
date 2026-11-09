// specs/guest-app.md rules 40, 48 — the studio's reach: hours a lodging only follows are `inert`, not just greyed
// out under the pointer; an article's title toggle is a 44 px target.
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ServicePage from '../pages/ServicePage';
import ShopItemsPage from '../pages/ShopItemsPage';
import { api } from '../services/api';
import {
  LA_GRANJA, L_ESTIVA, SETTINGS, renderStudio,
} from './studioFixtures';

vi.mock('../services/api', () => ({
  api: {
    settings: vi.fn(), saveSettings: vi.fn(), serviceHours: vi.fn(), saveServiceHours: vi.fn(), items: vi.fn(), media: vi.fn(), saveItem: vi.fn(),
  },
}));
vi.mock('../components/PhonePreview', () => ({ default: () => null }));

const WEEK = {
  propertyId: null, shared: true, weekly: { 0: [{ from: '09:00', to: '12:00' }], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }, exceptions: [],
};

describe('ServicePage — hours a lodging follows (rule 40)', () => {
  it('are inert until « Définir ses propres horaires »', async () => {
    api.settings.mockResolvedValue(SETTINGS);
    api.serviceHours.mockImplementation(async (propertyId) => ({ ...WEEK, propertyId: propertyId || null }));
    renderStudio(<ServicePage lodgings={[LA_GRANJA, L_ESTIVA]} />);
    const user = userEvent.setup();
    await screen.findByText('Semaine type');
    expect(screen.getByRole('group', { name: 'Lundi' }).closest('[inert]')).toBeNull();

    await user.click(screen.getByRole('combobox', { name: 'Horaires de' }));
    await user.click(await screen.findByRole('option', { name: 'L’Estiva' }));
    await screen.findByText('L’Estiva suit les horaires communs à tous les logements.');
    expect(document.querySelectorAll('[inert]')).toHaveLength(2);
    expect(document.querySelector('[inert]')).toContainElement(screen.getByText('Lundi'));

    await user.click(screen.getByRole('button', { name: 'Définir ses propres horaires' }));
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });
});

describe('ShopItemsPage — the title toggle (rule 48)', () => {
  it('is at least 44 px high', async () => {
    api.items.mockResolvedValue([{
      kind: 'option', id: 1, title: 'Cidre', priceType: 'per_stay', category: 'Boissons', archived: false, sellable: { ok: true, reason: null }, sold: true, mediaId: null, maxQuantity: 10, needsStaff: false, leadMinutes: 30, stockable: false, stock: { tracked: false }, price: 4.5, priceLabel: '4,50 €', priceUnitLabel: null,
    }]);
    api.media.mockResolvedValue([]);
    renderStudio(<ShopItemsPage lodging={LA_GRANJA} />);
    const toggle = (await screen.findByText('Cidre')).closest('[aria-expanded]');
    expect(window.getComputedStyle(toggle).minHeight).toBe('44px');
  });
});
