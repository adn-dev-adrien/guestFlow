/**
 * PlaceSheet — the sheet of one « Pratique » place (specs/guest-app/guest-app-local-amenities.md rules 6, 7): its category, name,
 * commune and drive time, whether it is open and the week's hours (today in bold), what can be dropped or which fuels
 * are sold, the note, « Vérifié le … », then « Itinéraire » and « Appeler ». Everything is read from the server's
 * payload: an absent field is absent. « Itinéraire » opens navigation directly (DirectionsLink), with the server's links.
 *
 * Props: `place` (an entry of `/places`), `open`, `onClose`, `stateShown` (false → no open / closed line and no « today » mark:
 * the payload is older than its `until` or was read without network, rule 13).
 */
import BottomSheet from './BottomSheet';
import DirectionsLink from './DirectionsLink';
import Icon from './Icon';
import { styleOf } from '../constants/placeCategories';
import { calendarDay } from '../utils/format';
import { useLang, useT } from '../i18n';

export default function PlaceSheet({ place, open, onClose, stateShown = true }) {
  const t = useT();
  const lang = useLang();
  const { color, Glyph } = styleOf(place.category, place.glyph);

  return (
    <BottomSheet open={open} onClose={onClose} label={place.name}>
      <div className="pl-sheet">
        <span className="pl-badge"><i style={{ background: color }}><Glyph size={13} strokeWidth={2.25} color="#FFFFFF" aria-hidden="true" /></i>{place.categoryLabel}</span>
        <h3>{place.name}</h3>
        <p className="pl-meta">{place.commune} · {place.driveLabel}</p>
        {stateShown ? <p className={`pl-state ${place.open.state}`}>{place.open.label}</p> : null}
        {place.hours ? (
          <table className="pl-hours">
            <tbody>
              {place.hours.map((row) => (
                <tr key={row.day} className={stateShown && row.today ? 'today' : undefined} aria-current={stateShown && row.today ? 'date' : undefined}>
                  <td>{row.day}</td>
                  <td>{row.ranges}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {place.wasteKind || place.accepts ? (
          <ul className="pl-tags" aria-label={t('places.accepts')}>
            {place.wasteKind ? <li className="kind">{place.wasteKind.label}</li> : null}
            {(place.accepts || []).map((a) => <li key={a.key}>{a.label}</li>)}
          </ul>
        ) : null}
        {place.energies ? (
          <ul className="pl-tags" aria-label={t('places.energies')}>
            {place.energies.map((e) => <li key={e.key}>{e.label}</li>)}
          </ul>
        ) : null}
        {place.note ? <p className="pl-note">{place.note}</p> : null}
        {place.verifiedOn ? <p className="pl-verified">{t('places.verified', { date: calendarDay(place.verifiedOn, lang) })}</p> : null}
        <div className="pl-acts">
          <DirectionsLink links={place.links}>{t('places.route')}</DirectionsLink>
          {place.telUrl ? <a className="btn ghost" href={place.telUrl}><Icon name="phone" />{t('common.call')}<span className="sr-only"> {place.phone}</span></a> : null}
        </div>
      </div>
    </BottomSheet>
  );
}
