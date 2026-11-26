// specs/guest-app/guest-app-local-amenities.md rules 1, 2, 4, 5, 9, 18 — « Pratique »: the chips (additive, « Tout » clears, a category with no place has
// none), the deep link of the booklet's button, the list grouped by category, the sheet closed by a filter that hides it, and the
// offline page that shows the list and says the map cannot load. The map itself (Leaflet) is replaced by a stand-in that
// draws one button per place it is given.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangContext } from '../i18n';
import { useActions } from '../hooks/useActions';
import { SessionProvider } from '../hooks/useSession';
import { OFFLINE, baseRoutes, renderApp, stubApi } from './guestFixtures';
import { PLACES, placesRoutes } from './placesFixtures';

vi.mock('../components/PlacesMap', async () => {
  const { forwardRef } = await import('react');
  return {
    default: forwardRef(({ places, onSelect }, ref) => (
      <div data-testid="map" ref={ref}>
        {places.map((p) => <button key={p.id} type="button" data-testid="marker" onClick={() => onSelect(p.id)}>{`marqueur ${p.name}`}</button>)}
      </div>
    )),
  };
});

afterEach(() => { vi.restoreAllMocks(); });

const markers = () => screen.queryAllByTestId('marker').map((m) => m.textContent.replace('marqueur ', ''));
const chips = () => within(screen.getByRole('group', { name: 'Filtrer par type de lieu' })).getAllByRole('button');

describe('PlacesPage — the chips (rule 4)', () => {
  it('draws « Tout » and one chip per category that holds a place, with its count, the map first', async () => {
    stubApi(placesRoutes());
    renderApp('/pratique');
    await screen.findByTestId('map');
    expect(chips().map((c) => c.textContent)).toEqual(['Tout', 'Déchets1', 'Boulangeries2']);
    expect(chips()[0]).toHaveAttribute('aria-pressed', 'true');
    expect(markers()).toEqual(['Point de collecte du bourg', 'Maison Roux', 'Boulangerie du Lac']);
  });

  it('chips are additive; « Tout » clears them', async () => {
    stubApi(placesRoutes());
    renderApp('/pratique');
    const user = userEvent.setup();
    await screen.findByTestId('map');
    await user.click(screen.getByRole('button', { name: /Boulangeries/ }));
    expect(markers()).toEqual(['Maison Roux', 'Boulangerie du Lac']);
    expect(chips()[0]).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: /^Déchets/ }));
    expect(markers()).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: /Boulangeries/ }));
    expect(markers()).toEqual(['Point de collecte du bourg']);
    await user.click(screen.getByRole('button', { name: 'Tout' }));
    expect(markers()).toHaveLength(3);
    expect(chips()[0]).toHaveAttribute('aria-pressed', 'true');
  });

  it('rule 18: the booklet button opens the page with that category\'s chip already on', async () => {
    stubApi(placesRoutes());
    renderApp('/pratique?c=dechets');
    await screen.findByTestId('map');
    expect(screen.getByRole('button', { name: /^Déchets/ })).toHaveAttribute('aria-pressed', 'true');
    expect(markers()).toEqual(['Point de collecte du bourg']);
  });

  it('a stale deep link to a category with no chip says « Rien dans ce filtre » and « Tout afficher » brings everything back', async () => {
    stubApi(placesRoutes());
    renderApp('/pratique?c=cinema');
    const user = userEvent.setup();
    expect(await screen.findByText('Rien dans ce filtre')).toBeInTheDocument();
    expect(screen.queryByTestId('map')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Tout afficher' }));
    expect(markers()).toHaveLength(3);
  });

  it('a filter that hides the open place closes its sheet', async () => {
    stubApi(placesRoutes());
    renderApp('/pratique');
    const user = userEvent.setup();
    await screen.findByTestId('map');
    await user.click(screen.getByRole('button', { name: 'marqueur Maison Roux' }));
    expect(await screen.findByRole('dialog', { name: 'Maison Roux' })).toBeInTheDocument();
    // The sheet's modal hides the chips from assistive tech; the filter state itself is what is under test.
    fireEvent.click(within(screen.getByRole('group', { name: 'Filtrer par type de lieu', hidden: true })).getByRole('button', { name: /^Déchets/, hidden: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Maison Roux' })).toBeNull());
  });
});

describe('PlacesPage — the list (rules 2, 5)', () => {
  it('the « Liste » switch groups the places by category, each row naming the place, its commune, its drive time and whether it is open', async () => {
    stubApi(placesRoutes());
    renderApp('/pratique');
    const user = userEvent.setup();
    await screen.findByTestId('map');
    await user.click(screen.getByRole('button', { name: 'Liste' }));
    expect(screen.queryByTestId('map')).toBeNull();
    const sections = screen.getAllByRole('region');
    expect(sections.map((s) => within(s).getByRole('heading').textContent)).toEqual(['Déchets', 'Boulangeries']);
    const rows = within(sections[1]).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Maison Roux');
    expect(rows[0]).toHaveTextContent('Satillieu · 4 min en voiture');
    expect(rows[0]).toHaveTextContent('Ouvert · ferme à 13 h');
    expect(rows[1]).toHaveTextContent('Fermé · ouvre à 15 h');
    expect(within(sections[0]).getByRole('button')).toHaveTextContent('Horaires non renseignés');
    await user.click(rows[0]);
    expect(await screen.findByRole('dialog', { name: 'Maison Roux' })).toBeInTheDocument();
  });
});

describe('PlacesPage — offline (rule 9)', () => {
  it('without network the list shows, whatever the choice, under « Pas de connexion : la carte ne peut pas se charger »', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    stubApi(placesRoutes());
    renderApp('/pratique');
    expect(await screen.findByText('Pas de connexion : la carte ne peut pas se charger')).toBeInTheDocument();
    expect(screen.queryByTestId('map')).toBeNull();
    expect(screen.getAllByRole('region')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Maison Roux/ })).toBeInTheDocument();
  });

  it('a first visit with no network and nothing cached says the network is needed, with « Réessayer »', async () => {
    stubApi(placesRoutes({ 'GET /places': OFFLINE }));
    renderApp('/pratique');
    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});

describe('Pratique — the module (rules 1, 18)', () => {
  it('rule 1: the home tile « Pratique » opens the page', async () => {
    stubApi(placesRoutes());
    renderApp('/');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Pratique' }));
    expect(await screen.findByRole('heading', { name: 'Pratique' })).toBeInTheDocument();
    await screen.findByTestId('map');
  });

  it('rule 1: a lodging that does not show the module sends the page back to the home', async () => {
    // The base session of the fixtures has no « Pratique » module.
    stubApi(baseRoutes({ 'GET /places': PLACES }));
    renderApp('/pratique');
    expect(await screen.findByRole('heading', { name: 'Bonjour Marie' })).toBeInTheDocument();
    expect(screen.queryByTestId('map')).toBeNull();
  });

  it('rule 18: a booklet button targeting « places » goes to the page, on the category when it names one', async () => {
    function Probe() {
      const { followTarget } = useActions();
      const { pathname, search } = useLocation();
      return (
        <>
          <button type="button" onClick={() => followTarget({ kind: 'places', category: 'dechets' })}>avec catégorie</button>
          <button type="button" onClick={() => followTarget({ kind: 'places' })}>sans catégorie</button>
          <output>{`${pathname}${search}`}</output>
        </>
      );
    }
    stubApi(placesRoutes());
    render(<LangContext.Provider value="fr"><MemoryRouter><SessionProvider><Probe /></SessionProvider></MemoryRouter></LangContext.Provider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'avec catégorie' }));
    expect(screen.getByRole('status')).toHaveTextContent('/pratique?c=dechets');
    await user.click(screen.getByRole('button', { name: 'sans catégorie' }));
    expect(screen.getByRole('status')).toHaveTextContent(/^\/pratique$/);
  });
});

describe('Pratique — the server order is the screen order (rule 5)', () => {
  it('the places keep the order the server sent', async () => {
    const reversed = { ...PLACES, places: [...PLACES.places].reverse() };
    stubApi(placesRoutes({ 'GET /places': reversed }));
    renderApp('/pratique');
    await screen.findByTestId('map');
    expect(markers()).toEqual(['Boulangerie du Lac', 'Maison Roux', 'Point de collecte du bourg']);
  });
});
