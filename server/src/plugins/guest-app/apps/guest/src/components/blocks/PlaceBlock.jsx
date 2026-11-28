/** PlaceBlock — a place: a map ground, its name and address, « Itinéraire » (DirectionsLink, rule 18 `place`). */
import DirectionsLink from '../DirectionsLink';
import Photo from '../Photo';
import { useT } from '../../i18n';

export default function PlaceBlock({ block }) {
  const t = useT();
  return (
    <div className="place">
      <Photo fallback="map" style={{ height: 120 }} />
      <div className="t">
        <div className="pt">{block.name ? <b>{block.name}</b> : null}{block.address ? <span>{block.address}</span> : null}</div>
        <DirectionsLink links={block.links} className="btn text" icon="pin">{t('booklet.itinerary')}</DirectionsLink>
      </div>
    </div>
  );
}
