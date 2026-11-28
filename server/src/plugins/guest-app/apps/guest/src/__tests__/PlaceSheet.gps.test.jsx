// specs/guest-app/guest-app-local-amenities.md rules 6, 7 — the place sheet: what it shows (absent fields are absent, today in bold), and
// « Itinéraire » (amended 2026-11-27): one button, no chooser, nothing remembered; Google Maps link, or the Apple chain.
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlaceSheet from '../components/PlaceSheet';
import { device } from '../services/device';
import { LangContext } from '../i18n';
import { openDirectionsOnApple } from '../utils/openDirections';
import { BAKERY, BAKERY_2, BINS } from './placesFixtures';

vi.mock('../utils/openDirections', async (original) => ({ ...(await original()), openDirectionsOnApple: vi.fn() }));

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36';

function renderSheet(place, { agent = IPHONE, lang = 'fr' } = {}) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(agent);
  vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue(agent === IPHONE ? 'iPhone' : 'Linux armv8l');
  const onClose = vi.fn();
  render(<LangContext.Provider value={lang}><div className="app"><PlaceSheet place={place} open onClose={onClose} /></div></LangContext.Provider>);
  return { onClose };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('PlaceSheet — what it shows (rule 6)', () => {
  it('names the place, its commune and drive time, whether it is open, the week with today in bold, the note and when it was checked', () => {
    renderSheet(BAKERY);
    const dialog = screen.getByRole('dialog', { name: 'Maison Roux' });
    expect(within(dialog).getByText('Boulangerie')).toBeInTheDocument();
    expect(within(dialog).getByText('Satillieu · 4 min en voiture')).toBeInTheDocument();
    expect(within(dialog).getByText('Ouvert · ferme à 13 h')).toBeInTheDocument();
    const today = within(dialog).getByRole('row', { current: 'date' });
    expect(today).toHaveTextContent('mardi');
    expect(today).toHaveClass('today');
    expect(within(dialog).getAllByRole('row')).toHaveLength(7);
    expect(within(dialog).getByText('Fermée le lundi après-midi')).toBeInTheDocument();
    expect(within(dialog).getByText('Vérifié le 1 juillet 2099')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Appeler/ })).toHaveAttribute('href', 'tel:0475123456');
  });

  it('an absent field is absent: no hours table, no phone button, no note', () => {
    renderSheet(BAKERY_2);
    const dialog = screen.getByRole('dialog', { name: 'Boulangerie du Lac' });
    expect(within(dialog).queryByRole('table')).toBeNull();
    expect(within(dialog).queryByRole('link', { name: /Appeler/ })).toBeNull();
    expect(within(dialog).queryByText(/N\/A|—/)).toBeNull();
    expect(within(dialog).getByText('Fermé · ouvre à 15 h')).toBeInTheDocument();
  });

  it('a waste place says what can be dropped, with its kind', () => {
    renderSheet(BINS);
    const tags = screen.getByRole('list', { name: 'Ce qu’on peut y déposer' });
    expect(within(tags).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Point de collecte', 'Ordures ménagères', 'Verre']);
    expect(screen.getByText('Horaires non renseignés')).toBeInTheDocument();
  });

  it('a fuel place lists its energies', () => {
    renderSheet({ ...BINS, category: 'carburant', categoryLabel: 'Carburant et recharge', wasteKind: null, accepts: null, energies: [{ key: 'gazole', label: 'Gazole' }, { key: 'recharge', label: 'Recharge électrique' }] });
    expect(within(screen.getByRole('list', { name: 'Énergies proposées' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Gazole', 'Recharge électrique']);
  });

  it('reads in English', () => {
    renderSheet({ ...BAKERY, driveLabel: '4 min drive', open: { state: 'open', label: 'Open · closes at 1 pm' } }, { lang: 'en' });
    expect(screen.getByText('Checked on 1 July 2099')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Directions' })).toBeInTheDocument();
  });
});

describe('PlaceSheet — « Itinéraire » (rule 7)', () => {
  it('is one link to the Google Maps directions, with no chooser, no « Changer d\'appli », nothing remembered', async () => {
    renderSheet(BAKERY, { agent: ANDROID });
    const link = screen.getByRole('link', { name: 'Itinéraire' });
    expect(link).toHaveAttribute('href', BAKERY.links.google);
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.queryByText(/Changer d/)).toBeNull();
    expect(screen.queryByText(/Waze/)).toBeNull();
    link.addEventListener('click', (e) => e.preventDefault());
    await userEvent.setup().click(link);
    expect(device.get('gps')).toBeUndefined();
  });

  it('on an Apple device the tap runs the Apple chain with the server\'s links instead of following the link', () => {
    renderSheet(BAKERY);
    fireEvent.click(screen.getByRole('link', { name: 'Itinéraire' }));
    expect(openDirectionsOnApple).toHaveBeenCalledExactlyOnceWith(BAKERY.links);
  });

  it('elsewhere the chain is never run', () => {
    renderSheet(BAKERY, { agent: ANDROID });
    const link = screen.getByRole('link', { name: 'Itinéraire' });
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(link);
    expect(openDirectionsOnApple).not.toHaveBeenCalled();
  });
});
