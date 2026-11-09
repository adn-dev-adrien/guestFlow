/**
 * The bath (rules 28-31, §6.6 Bath): « BIEN-ÊTRE », the free-time chip, day chips, the bookable slots of the
 * day — read from GuestFlow's resource planning by the server — and a sticky button with the server's price
 * of the selection. Several slots, several days, one order (rule 29).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import AppBar from '../components/AppBar';
import SlotGrid, { slotKey } from '../components/SlotGrid';
import StatusChip from '../components/StatusChip';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import Skeleton from '../components/Skeleton';
import { NeedNetwork, cartInfo, useShop } from './ShopPage';
import { lineKey, useCart } from '../hooks/useCart';
import { useSession } from '../hooks/useSession';
import { useLoad } from '../hooks/useLoad';
import { useLineQuote } from '../hooks/useLineQuote';
import { useOnline } from '../hooks/useOnline';
import { api } from '../services/api';
import { useT } from '../i18n';

export default function SlotPickerPage() {
  const t = useT();
  const navigate = useNavigate();
  const online = useOnline();
  const { id } = useParams();
  const { lang } = useSession();
  const cart = useCart();
  const shop = useShop();
  const resource = useMemo(() => {
    if (!shop.data) return null;
    const all = shop.data.categories.flatMap((c) => c.items.map((item) => ({ item, category: c.name })));
    return all.find(({ item }) => item.scheduling === 'hourly' && (!id || String(item.id) === String(id))) || null;
  }, [shop.data, id]);
  const resourceId = resource ? resource.item.id : null;
  const slots = useLoad(() => (resourceId ? api.slots(resourceId) : Promise.resolve(null)), [resourceId, lang]);
  const inCart = resource ? cart.lines.find((l) => lineKey(l) === `resource:${resourceId}`) : null;
  const [picked, setPicked] = useState([]);
  const [day, setDay] = useState(null);
  useEffect(() => { setPicked(inCart ? inCart.sessions : []); }, [resourceId]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = useMemo(() => new Set(picked.map((s) => `${s.date}|${s.start}|${s.end}`)), [picked]);
  const line = resource && picked.length ? { kind: 'resource', id: resourceId, sessions: picked } : null;
  const { quote } = useLineQuote(line, Boolean(line));

  if (!online && !shop.data) return <NeedNetwork title={t('bath.title')} back="/boutique" />;
  const bar = <AppBar title={resource ? resource.item.title : t('bath.title')} back="/boutique" />;
  if (shop.error || slots.error) {
    return <div className="scroll enter">{bar}<div className="pad"><ErrorAlert error={shop.error || slots.error} onRetry={() => { shop.reload(); slots.reload(); }} /></div></div>;
  }
  if (!shop.data || (resource && !slots.data)) return <div className="scroll enter">{bar}<Skeleton lines={4} label={t('common.loading')} /></div>;
  if (!resource) return <div className="scroll enter">{bar}<EmptyState icon="bath" title={t('bath.none')} /></div>;

  const days = slots.data.days || [];
  const toggle = (slot, date) => {
    const key = slotKey(date, slot);
    setPicked((cur) => (selected.has(key) ? cur.filter((s) => `${s.date}|${s.start}|${s.end}` !== key) : [...cur, { date, start: slot.start, end: slot.end }]));
  };
  const confirm = () => {
    cart.replace({ kind: 'resource', id: resourceId, sessions: picked }, cartInfo(resource.item));
    navigate('/panier');
  };
  const quoteLine = quote && quote.lines && quote.lines[0];
  const unavailable = quoteLine && quoteLine.sessions ? quoteLine.sessions.filter((s) => s.unavailable) : [];

  return (
    <>
      <div className="scroll enter">
        {bar}
        <div className="pad">
          <p className="eb">{resource.category}</p>
          {resource.item.shortDescription ? <p style={{ margin: 0, color: 'var(--ink-soft)' }}>{resource.item.shortDescription}</p> : <p style={{ margin: 0, color: 'var(--ink-soft)' }}>{t('bath.intro')}</p>}
          {slots.data.freeLabel ? <div><StatusChip tone={slots.data.freeMinutesLeft > 0 ? 'ok' : 'mut'}>{slots.data.freeLabel}</StatusChip></div> : null}
          {unavailable.map((s) => <p key={`${s.date}${s.start}`} className="hint bad" role="alert">{s.label} · {s.reasonLabel}</p>)}
          {days.length
            ? <SlotGrid days={days} day={day || days[0].date} onDay={setDay} selected={selected} onToggle={toggle} />
            : <EmptyState icon="bath" title={t('bath.none')} />}
        </div>
      </div>
      {picked.length ? (
        <div className="sticky-cta">
          <button type="button" className="btn block" onClick={confirm} disabled={unavailable.length === picked.length}>
            {quote ? t('shop.addTotal', { total: quote.totalLabel }) : t('bath.addN', { n: picked.length })}
          </button>
        </div>
      ) : null}
    </>
  );
}
