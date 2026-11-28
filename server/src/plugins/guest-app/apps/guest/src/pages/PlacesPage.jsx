/**
 * Pratique — the shops, services and waste points around the estate (specs/guest-app/guest-app-local-amenities.md). Map first, with a
 * « Carte · Liste » switch under the category chips; a tap on a marker or a row opens the place's sheet. Every figure and
 * label comes from `/places`; the filtering by chip is the screen's own state. Without network the page shows the list,
 * cached with the booklet, and says the map cannot load (rule 9).
 *
 * `?c=<category>` opens the page with that chip on (the booklet's button, rule 18).
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import AppBar from '../components/AppBar';
import Banner from '../components/Banner';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import Icon from '../components/Icon';
import PlaceSheet from '../components/PlaceSheet';
import Segmented from '../components/Segmented';
import Skeleton from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { styleOf } from '../constants/placeCategories';
import { useLoad } from '../hooks/useLoad';
import { useOnline } from '../hooks/useOnline';
import { useSession } from '../hooks/useSession';
import { api } from '../services/api';
import { useT } from '../i18n';

// Leaflet only loads with this screen: the home and the shop do not pay for it.
const PlacesMap = lazy(() => import('../components/PlacesMap'));

function CategoryDot({ category, glyph, size = 18 }) {
  const { color, Glyph: Mark } = styleOf(category, glyph);
  return <span className="pl-dot" style={{ background: color }}><Mark size={size} strokeWidth={2.25} color="#FFFFFF" aria-hidden="true" focusable="false" /></span>;
}

// setTimeout holds a delay in 32 bits.
const MAX_DELAY = 2 ** 31 - 1;

/** Rule 13 — a state is never shown past its `until`, nor without the network (a payload read from the cache is as old as its last visit). */
const stateStale = (place, online) => !online || (Boolean(place.open.until) && Date.parse(place.open.until) <= Date.now());

function PlaceRow({ place, stale, onOpen }) {
  return (
    <li>
      <button type="button" className="pl-row" onClick={() => onOpen(place.id)}>
        <CategoryDot category={place.category} glyph={place.glyph} />
        <span className="pl-row-main">
          <b>{place.name}</b>
          <span>{place.commune} · {place.driveLabel}</span>
        </span>
        {stale ? null : <span className={`pl-row-state ${place.open.state}`}>{place.open.label}</span>}
      </button>
    </li>
  );
}

export default function PlacesPage() {
  const t = useT();
  const toast = useToast();
  const online = useOnline();
  const { lang } = useSession();
  const [params] = useSearchParams();
  const wanted = params.get('c');
  const [filters, setFilters] = useState(() => new Set(wanted ? [wanted] : []));
  const [view, setView] = useState('map');
  const [openId, setOpenId] = useState(null);
  const map = useRef(null);
  const { data, error, reload } = useLoad(() => api.places(), [lang]);
  const [, setClock] = useState(0);

  const shown = useMemo(() => {
    const all = (data && data.places) || [];
    return filters.size ? all.filter((p) => filters.has(p.category)) : all;
  }, [data, filters]);
  // Rule 13 — read again when a shown state expires, when the app comes back to the foreground and when the network returns.
  useEffect(() => {
    const ahead = shown.map((p) => Date.parse(p.open.until)).filter((at) => at > Date.now());
    if (!ahead.length) return undefined;
    const timer = setTimeout(() => { setClock((n) => n + 1); reload(); }, Math.min(Math.min(...ahead) - Date.now() + 250, MAX_DELAY));
    return () => clearTimeout(timer);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible') { setClock((n) => n + 1); reload(); } };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [reload]);
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) reload();
    wasOnline.current = online;
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const opened = openId === null ? null : shown.find((p) => p.id === openId) || null;
  useEffect(() => { if (openId !== null && !opened) setOpenId(null); }, [openId, opened]);

  const toggle = (key) => setFilters((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const clear = () => setFilters(new Set());

  const categories = (data && data.categories) || [];
  const grouped = categories.map((c) => ({ ...c, places: shown.filter((p) => p.category === c.key) })).filter((g) => g.places.length);
  const mapVisible = online && view === 'map';

  let body;
  if (!data && error) body = <div className="pad"><ErrorAlert error={error} onRetry={reload} /></div>;
  else if (!data) body = <Skeleton lines={6} label={t('common.loading')} />;
  else if (!shown.length) {
    body = (
      <EmptyState icon="pin" title={t('places.none')}>
        <button type="button" className="btn ghost" onClick={clear}>{t('places.showAll')}</button>
      </EmptyState>
    );
  } else if (mapVisible) {
    body = (
      <div className="pl-mapwrap">
        <Suspense fallback={<div className="pl-map" aria-busy="true" />}>
          <PlacesMap ref={map} places={shown} estate={data.estate} selectedId={openId} onSelect={setOpenId} onLocateError={() => toast(t('places.locateFailed'))} />
        </Suspense>
        <div className="pl-ctl">
          <button type="button" aria-label={t('places.zoomIn')} onClick={() => map.current && map.current.zoomIn()}><Icon name="plus" /></button>
          <button type="button" aria-label={t('places.zoomOut')} onClick={() => map.current && map.current.zoomOut()}><Icon name="minus" /></button>
          <button type="button" aria-label={t('places.locate')} onClick={() => map.current && map.current.locate()}><Icon name="locate" /></button>
        </div>
        <a className="pl-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>
      </div>
    );
  } else {
    body = (
      <div className="pl-list">
        {grouped.map((g) => (
          <section key={g.key} aria-labelledby={`pl-g-${g.key}`}>
            <h2 id={`pl-g-${g.key}`}>{g.label}</h2>
            <ul>{g.places.map((p) => <PlaceRow key={p.id} place={p} stale={stateStale(p, online)} onOpen={setOpenId} />)}</ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="pl-page">
      <div className="pl-top">
        <AppBar title={t('places.title')} back="/" />
        {categories.length ? (
          <div className="chips" role="group" aria-label={t('places.filters')}>
            <button type="button" className="chip" aria-pressed={filters.size === 0} onClick={clear}>{t('places.all')}</button>
            {categories.map((c) => (
              <button key={c.key} type="button" className="chip" aria-pressed={filters.has(c.key)} onClick={() => toggle(c.key)}>
                <i className="pl-chip-dot" style={{ background: styleOf(c.key).color }} aria-hidden="true" />
                {c.label}
                <small>{c.count}</small>
              </button>
            ))}
          </div>
        ) : null}
        {data ? (
          <div className="pl-switch">
            <Segmented
              label={t('places.view')}
              value={mapVisible ? 'map' : 'list'}
              onChange={(next) => { if (online || next === 'list') setView(next); }}
              options={[{ value: 'map', label: t('places.map') }, { value: 'list', label: t('places.list') }]}
            />
          </div>
        ) : null}
        {data && !online ? <div className="pl-offline"><Banner tone="warn" icon="cloudoff" role="status">{t('places.offline')}</Banner></div> : null}
      </div>
      <div className={`pl-body${mapVisible && shown.length ? ' is-map' : ''}`}>{body}</div>
      {opened ? <PlaceSheet key={opened.id} place={opened} stateShown={!stateStale(opened, online)} open onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}
