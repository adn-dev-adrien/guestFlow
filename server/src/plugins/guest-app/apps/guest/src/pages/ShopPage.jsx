/**
 * The shop (rules 22-27bis, 37quater, 42, §6.6): « LA BOUTIQUE », sticky category chips, the bath as a
 * featured photo when it is sold here, the articles in a 2-column grid (3 on a tablet, 4 on a desktop), the
 * service banner when the team is away. Pre-arrival: read only. From 900 px the cart sits beside the
 * catalogue and the cart bar goes (rule 51).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import AppBar from '../components/AppBar';
import Photo from '../components/Photo';
import ProductCard from '../components/ProductCard';
import ProductSheet, { maxFor } from '../components/ProductSheet';
import BreakfastSheet from '../components/BreakfastSheet';
import ServiceHoursBanner from '../components/ServiceHoursBanner';
import Banner from '../components/Banner';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import Skeleton from '../components/Skeleton';
import CartBody from '../components/CartBody';
import { useCart, lineKey } from '../hooks/useCart';
import { useSession } from '../hooks/useSession';
import { useLoad } from '../hooks/useLoad';
import { useLayout } from '../hooks/useLayout';
import { useOnline } from '../hooks/useOnline';
import { api } from '../services/api';
import { useT } from '../i18n';

const keyOf = (item) => `${item.kind}:${item.id}`;
export const cartInfo = (item) => ({ title: item.title, imageUrl: item.imageUrl, max: maxFor(item), item });

export function NeedNetwork({ title, back }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="scroll enter">
      <AppBar title={title} back={back} />
      <EmptyState icon="cloudoff" title={t('net.needed')} text={t('net.shop')}>
        <button type="button" className="btn ghost" onClick={() => navigate('/livret')}>{t('net.openBooklet')}</button>
      </EmptyState>
    </div>
  );
}

export function useShop() {
  const { lang } = useSession();
  return useLoad(() => api.shop(), [lang]);
}

export default function ShopPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const layout = useLayout();
  const online = useOnline();
  const { me } = useSession();
  const cart = useCart();
  const shop = useShop();
  const [sheet, setSheet] = useState(null);
  const [activeCat, setActiveCat] = useState(null);
  const scroller = useRef(null);
  const readOnly = !shop.data || !shop.data.open;

  const items = useMemo(() => (shop.data ? shop.data.categories.flatMap((c) => c.items.map((item) => ({ item, category: c.name }))) : []), [shop.data]);
  const bath = items.find(({ item }) => item.scheduling === 'hourly');

  // Rule 18 — a booklet button to an article opens it here.
  useEffect(() => {
    const wanted = params.get('article');
    if (!wanted || !items.length) return;
    const hit = items.find(({ item }) => keyOf(item) === wanted);
    if (hit) setSheet(hit);
    setParams({}, { replace: true });
  }, [params, items, setParams]);

  if (!online && !shop.data) return <NeedNetwork title={t('shop.title')} />;
  if (!shop.data) {
    return (
      <div className="scroll enter">
        <AppBar title={t('shop.title')} />
        {shop.error ? <div className="pad"><ErrorAlert error={shop.error} onRetry={shop.reload} /></div> : <Skeleton blocks={2} lines={2} label={t('common.loading')} />}
      </div>
    );
  }

  const open = (entry) => {
    if (entry.item.scheduling === 'hourly') { if (!readOnly) navigate(`/boutique/bain/${entry.item.id}`); return; }
    setSheet(entry);
  };
  const quickAdd = (entry) => {
    const { item } = entry;
    if (item.scheduling === 'hourly') { navigate(`/boutique/bain/${item.id}`); return; }
    if (item.kind === 'breakfast') { setSheet(entry); return; }
    const inCart = cart.lines.find((l) => lineKey(l) === keyOf(item));
    if (inCart && inCart.quantity >= maxFor(item)) { setSheet(entry); return; }
    cart.add({ kind: item.kind, id: item.id, quantity: 1 }, cartInfo(item));
  };
  const goCat = (name) => {
    setActiveCat(name);
    const el = scroller.current && scroller.current.querySelector(`[data-cat="${CSS.escape(name)}"]`);
    if (el) el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  const data = shop.data;
  const top = !data.open
    ? <Banner tone="mut" icon="info">{data.closedReason}</Banner>
    : <ServiceHoursBanner service={data.service} />;
  const feature = bath ? (
    <Photo
      as="button"
      type="button"
      src={bath.item.imageUrl}
      scrim
      fallback="night"
      className="feature"
      aria-disabled={readOnly || undefined}
      onClick={() => open(bath)}
    >
      <span className="in">
        <span className="eb">{bath.category}{bath.item.freeLeftLabel ? ` · ${bath.item.freeLeftLabel}` : ''}</span>
        <b>{bath.item.title}</b>
        <span className="go">{readOnly ? t('shop.fromArrival') : t('shop.pickSlot')}</span>
      </span>
    </Photo>
  ) : null;

  const main = (
    <div className="scroll enter" ref={scroller}>
      <div className="stickhead">
        <AppBar title={t('shop.title')} />
        {data.categories.length > 1 ? (
          <div className="chips" role="group" aria-label={t('shop.categories')}>
            {data.categories.filter((c) => c.items.some((item) => !bath || item !== bath.item)).map((c) => <button key={c.name} type="button" className="chip" aria-pressed={activeCat === c.name} onClick={() => goCat(c.name)}>{c.name}</button>)}
          </div>
        ) : null}
      </div>
      <div className="pad">
        {top}
        {feature}
        {!items.length ? <EmptyState icon="shop" title={t('shop.empty')} /> : null}
        {data.categories.map((c) => {
          const list = c.items.filter((item) => !bath || item !== bath.item);
          if (!list.length) return null;
          return (
            <section className="cat" key={c.name} data-cat={c.name} aria-label={c.name}>
              <h2>{c.name}</h2>
              <div className="grid">
                {list.map((item) => (
                  <ProductCard key={keyOf(item)} item={item} readOnly={readOnly} onOpen={() => open({ item, category: c.name })} onAdd={() => quickAdd({ item, category: c.name })} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );

  const sheets = (
    <>
      <ProductSheet
        item={sheet && sheet.item.kind !== 'breakfast' ? sheet.item : null}
        category={sheet ? sheet.category : null}
        readOnly={readOnly}
        inCart={sheet ? ((cart.lines.find((l) => lineKey(l) === keyOf(sheet.item)) || {}).quantity || 0) : 0}
        open={Boolean(sheet) && sheet.item.kind !== 'breakfast'}
        onClose={() => setSheet(null)}
        onAdd={(quantity) => { cart.add({ kind: sheet.item.kind, id: sheet.item.id, quantity }, cartInfo(sheet.item)); setSheet(null); }}
      />
      <BreakfastSheet
        item={sheet && sheet.item.kind === 'breakfast' ? sheet.item : null}
        partySize={me.stay ? me.stay.partySize : 1}
        readOnly={readOnly}
        open={Boolean(sheet) && sheet.item.kind === 'breakfast'}
        initial={sheet && sheet.item.kind === 'breakfast' ? cart.lines.find((l) => lineKey(l) === keyOf(sheet.item)) : null}
        onClose={() => setSheet(null)}
        onAdd={(line) => { cart.replace(line, cartInfo(sheet.item)); setSheet(null); }}
      />
    </>
  );

  if (layout.wide && !readOnly) {
    return (
      <>
        <div className="twopane shopp">
          <div className="paneL">{main}</div>
          <div className="paneR"><aside className="cartpanel" aria-label={t('cart.panel')}><h2>{t('cart.title')}</h2><CartBody shop={data} inPanel /></aside></div>
        </div>
        {sheets}
      </>
    );
  }
  return <>{main}{sheets}</>;
}
