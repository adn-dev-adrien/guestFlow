/**
 * PlaceSheet — the sheet of one « Pratique » place (specs/guest-app/guest-app-local-amenities.md rules 6, 7): its category, name,
 * commune and drive time, whether it is open and the week's hours (today in bold), what can be dropped or which fuels
 * are sold, the note, « Vérifié le … », then « Itinéraire » and « Appeler ». Everything is read from the server's
 * payload: an absent field is absent. « Itinéraire » offers Plans (Apple devices only), Google Maps and Waze on the first
 * tap; the choice stays on the device and later taps open it directly, « Changer d'appli » asking again. The three links
 * come from the server.
 *
 * Props: `place` (an entry of `/places`), `open`, `onClose`.
 */
import { useState } from 'react';
import BottomSheet from './BottomSheet';
import Icon from './Icon';
import { styleOf } from '../constants/placeCategories';
import { device } from '../services/device';
import { calendarDay } from '../utils/format';
import { useLang, useT } from '../i18n';

export const GPS_APPS = Object.freeze(['apple', 'google', 'waze']);
const GPS_KEY = 'gps';

/** Plans exists on Apple devices only (iPadOS answers as a Mac, hence the touch check). */
export function isAppleDevice() {
  if (typeof navigator === 'undefined') return false;
  const platform = String(navigator.userAgentData && navigator.userAgentData.platform || navigator.platform || '');
  const agent = String(navigator.userAgent || '');
  return /iPhone|iPad|iPod/.test(agent) || /^(iPhone|iPad|iPod)/.test(platform) || (/Mac/.test(platform) && navigator.maxTouchPoints > 1);
}

const available = () => GPS_APPS.filter((app) => app !== 'apple' || isAppleDevice());

/** The app remembered on this device, if it still can be used here. */
function remembered() {
  const app = device.get(GPS_KEY);
  return available().includes(app) ? app : null;
}

const APP_LABEL_KEY = { apple: 'places.gps.apple', google: 'places.gps.google', waze: 'places.gps.waze' };

export default function PlaceSheet({ place, open, onClose }) {
  const t = useT();
  const lang = useLang();
  const [choice, setChoice] = useState(remembered);
  const [choosing, setChoosing] = useState(false);
  const { color, Glyph } = styleOf(place.category);

  const pick = (app) => {
    device.set(GPS_KEY, app);
    setChoice(app);
    setChoosing(false);
  };
  const change = () => {
    device.set(GPS_KEY, null);
    setChoice(null);
    setChoosing(true);
  };

  const route = choice && !choosing ? (
    <a className="btn" href={place.links[choice]} target="_blank" rel="noopener noreferrer">
      <Icon name="nav" />
      {t('places.route')}
      <span className="sr-only"> — {t(APP_LABEL_KEY[choice])}</span>
    </a>
  ) : (
    <button type="button" className="btn" aria-expanded={choosing} onClick={() => setChoosing((v) => !v)}>
      <Icon name="nav" />
      {t('places.route')}
    </button>
  );

  return (
    <BottomSheet open={open} onClose={onClose} label={place.name}>
      <div className="pl-sheet">
        <span className="pl-badge"><i style={{ background: color }}><Glyph size={13} strokeWidth={2.25} color="#FFFFFF" aria-hidden="true" /></i>{place.categoryLabel}</span>
        <h3>{place.name}</h3>
        <p className="pl-meta">{place.commune} · {place.driveLabel}</p>
        <p className={`pl-state ${place.open.state}`}>{place.open.label}</p>
        {place.hours ? (
          <table className="pl-hours">
            <tbody>
              {place.hours.map((row) => (
                <tr key={row.day} className={row.today ? 'today' : undefined} aria-current={row.today ? 'date' : undefined}>
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
          {route}
          {place.telUrl ? <a className="btn ghost" href={place.telUrl}><Icon name="phone" />{t('common.call')}<span className="sr-only"> {place.phone}</span></a> : null}
        </div>
        {choice && !choosing ? (
          <button type="button" className="btn text pl-change" onClick={change}>{t('places.changeApp')}</button>
        ) : null}
        {choosing ? (
          <div className="pl-chooser" role="group" aria-label={t('places.chooseApp')}>
            {available().map((app) => (
              <a key={app} href={place.links[app]} target="_blank" rel="noopener noreferrer" onClick={() => pick(app)}>
                <Icon name="nav" />
                {t(APP_LABEL_KEY[app])}
              </a>
            ))}
            <small>{t('places.rememberHint')}</small>
          </div>
        ) : null}
      </div>
    </BottomSheet>
  );
}
