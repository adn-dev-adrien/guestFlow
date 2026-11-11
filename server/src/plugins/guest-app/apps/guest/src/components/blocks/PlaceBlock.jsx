/** PlaceBlock — a place: a map ground, its name and address, « Itinéraire » to the maps app (rule 18 `place`). */
import Icon from '../Icon';
import Photo from '../Photo';
import { useT } from '../../i18n';

export default function PlaceBlock({ block }) {
  const t = useT();
  return (
    <div className="place">
      <Photo fallback="map" style={{ height: 120 }} />
      <div className="t">
        <div className="pt">{block.name ? <b>{block.name}</b> : null}{block.address ? <span>{block.address}</span> : null}</div>
        <a className="btn text" href={block.mapsUrl} target="_blank" rel="noopener noreferrer"><Icon name="pin" />{t('booklet.itinerary')}</a>
      </div>
    </div>
  );
}
