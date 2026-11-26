// specs/guest-app/guest-app-local-amenities.md rules 6, 7 — the place sheet: what it shows (absent fields are absent, today in bold), and
// « Itinéraire »: Plans (Apple devices only), Google Maps and Waze on the first tap with the server's three links, the choice
// remembered on the device, then opened directly with « Changer d'appli » under the button.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlaceSheet from '../components/PlaceSheet';
import { device } from '../services/device';
import { LangContext } from '../i18n';
import { BAKERY, BAKERY_2, BINS } from './placesFixtures';

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
    expect(screen.getByRole('button', { name: 'Directions' })).toBeInTheDocument();
  });
});

describe('PlaceSheet — « Itinéraire » (rule 7)', () => {
  it('the first tap offers Plans, Google Maps and Waze on an Apple device, with the links the server built', async () => {
    renderSheet(BAKERY);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Itinéraire' }));
    const chooser = screen.getByRole('group', { name: 'Ouvrir l’itinéraire avec' });
    const links = within(chooser).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['Plans', 'Google Maps', 'Waze']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([BAKERY.links.apple, BAKERY.links.google, BAKERY.links.waze]);
    links.forEach((a) => expect(a).toHaveAttribute('target', '_blank'));
  });

  it('Plans is offered on Apple devices only', async () => {
    renderSheet(BAKERY, { agent: ANDROID });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Itinéraire' }));
    expect(within(screen.getByRole('group', { name: 'Ouvrir l’itinéraire avec' })).getAllByRole('link').map((a) => a.textContent)).toEqual(['Google Maps', 'Waze']);
  });

  it('the choice is remembered on the device: later taps open it directly, « Changer d\'appli » asks again', async () => {
    const first = renderSheet(BAKERY);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Itinéraire' }));
    const waze = within(screen.getByRole('group', { name: 'Ouvrir l’itinéraire avec' })).getByRole('link', { name: 'Waze' });
    waze.addEventListener('click', (e) => e.preventDefault());
    await user.click(waze);
    expect(device.get('gps')).toBe('waze');
    expect(window.localStorage.getItem('gf-guest')).toContain('"gps":"waze"');
    expect(first.onClose).not.toHaveBeenCalled();

    // Back on the sheet later (another place, same device): the button is the link itself.
    document.body.innerHTML = '';
    renderSheet(BAKERY_2);
    const direct = screen.getByRole('link', { name: /Itinéraire/ });
    expect(direct).toHaveAttribute('href', BAKERY_2.links.waze);
    expect(screen.queryByRole('group', { name: 'Ouvrir l’itinéraire avec' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Changer d’appli' }));
    expect(device.get('gps')).toBeUndefined();
    expect(within(screen.getByRole('group', { name: 'Ouvrir l’itinéraire avec' })).getAllByRole('link')).toHaveLength(3);
  });

  it('Plans remembered on an Apple device is not used on another one', () => {
    device.set('gps', 'apple');
    renderSheet(BAKERY, { agent: ANDROID });
    expect(screen.getByRole('button', { name: 'Itinéraire' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Itinéraire/ })).toBeNull();
  });
});
