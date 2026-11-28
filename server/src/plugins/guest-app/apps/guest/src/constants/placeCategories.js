/**
 * « Pratique » — what the app draws for each category (specs/guest-app/guest-app-local-amenities.md rule 10): its
 * glyph (Lucide) and its colour. The labels, the order and the counts come from the server.
 *
 * Colours — the one place the app spells category colours, outside the day / night tokens. Each is a marker
 * fill under a white glyph and a white ring: ≥ 3:1 against the white glyph (4.3 to 7.6:1) and against the map
 * ground of OpenStreetMap's tiles (#F2EFE9, 3.7 to 6.6:1), the tiles staying light in both registers; any two
 * differ by ΔE76 ≥ 23 (CIELAB, D65). Identity never rests on colour alone: the glyph and the label say it too.
 */
// Each glyph twice: the component, for the page; its drawing data, for the Leaflet markers (an HTML string, no React tree).
import Banknote, { __iconData as banknote } from 'lucide-react/icons/banknote';
import Beef, { __iconData as beef } from 'lucide-react/icons/beef';
import Croissant, { __iconData as croissant } from 'lucide-react/icons/croissant';
import Cross, { __iconData as cross } from 'lucide-react/icons/cross';
import EvCharger, { __iconData as evCharger } from 'lucide-react/icons/ev-charger';
import Fuel, { __iconData as fuel } from 'lucide-react/icons/fuel';
import Mail, { __iconData as mail } from 'lucide-react/icons/mail';
import Newspaper, { __iconData as newspaper } from 'lucide-react/icons/newspaper';
import ShoppingBasket, { __iconData as shoppingBasket } from 'lucide-react/icons/shopping-basket';
import Trash, { __iconData as trash } from 'lucide-react/icons/trash';

export const PLACE_STYLE = Object.freeze({
  dechets: Object.freeze({ color: '#4E6B3A', Glyph: Trash, data: trash }),
  boulangerie: Object.freeze({ color: '#B0691A', Glyph: Croissant, data: croissant }),
  pharmacie: Object.freeze({ color: '#1F7A6A', Glyph: Cross, data: cross }),
  boucherie: Object.freeze({ color: '#A8433A', Glyph: Beef, data: beef }),
  epicerie: Object.freeze({ color: '#2A6BB8', Glyph: ShoppingBasket, data: shoppingBasket }),
  tabac: Object.freeze({ color: '#5B4BA7', Glyph: Newspaper, data: newspaper }),
  poste: Object.freeze({ color: '#9C2F6B', Glyph: Mail, data: mail }),
  distributeur: Object.freeze({ color: '#4A5560', Glyph: Banknote, data: banknote }),
  carburant: Object.freeze({ color: '#7C4A1E', Glyph: Fuel, data: fuel }),
});

const FALLBACK = Object.freeze({ color: '#4A5560', Glyph: ShoppingBasket, data: shoppingBasket });

/** The glyph the server names for a place of the category (rule 10: charging-only fuel place → `charging`); same colour. */
const GLYPHS = Object.freeze({ charging: { Glyph: EvCharger, data: evCharger } });

export const styleOf = (category, glyph) => {
  const style = PLACE_STYLE[category] || FALLBACK;
  return GLYPHS[glyph] ? { ...style, ...GLYPHS[glyph] } : style;
};

/** The dot « Me localiser » draws for the device's position (rule 8): the usual map blue, with its halo. */
export const LOCATION_COLOR = '#2A6BB8';
