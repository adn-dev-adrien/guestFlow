/**
 * Scheduling the bath from the home (specs/guest-app-bath-home-scheduling.md rules 8-19, §6): what the stay owns, « À la suite » /
 * « Réparties » when there are two hours or more, the server's blocks or the slot grid with its counter, the stepper « Heures en
 * plus », and the server's quote line by line under a sticky button that carries its total. At 0 € the sessions are placed at once
 * (`POST /orders`, nothing sold); above, the line goes to the cart, whose payment choice is the app's own.
 *
 * Route: `/bain/programmer/:id`, `?ajout=1` opens it with one extra hour (« Ajouter une heure », « Réserver »).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import AppBar from '../components/AppBar';
import SlotGrid, { slotKey } from '../components/SlotGrid';
import Segmented from '../components/Segmented';
import QuantityStepper from '../components/QuantityStepper';
import StatusChip from '../components/StatusChip';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import Banner from '../components/Banner';
import Skeleton from '../components/Skeleton';
import { NeedNetwork, cartInfo, useShop } from './ShopPage';
import { useCart } from '../hooks/useCart';
import { useSession } from '../hooks/useSession';
import { useLoad } from '../hooks/useLoad';
import { useLineQuote } from '../hooks/useLineQuote';
import { useOnline } from '../hooks/useOnline';
import { api } from '../services/api';
import { useLang, useT } from '../i18n';
import { clockLabel } from '../utils/format';

const sameSession = (a, b) => a.date === b.date && a.start === b.start && a.end === b.end;
const keyOf = (s) => `${s.date}|${s.start}|${s.end}`;

function newKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Rule 10 — the starts of one session of N hours, by day: day chips, then one chip per start. */
function Blocks({ days, day, onDay, picked, onPick }) {
  const t = useT();
  const lang = useLang();
  const current = days.find((d) => d.date === day) || days[0];
  return (
    <>
      <div className="daysrow" role="group" aria-label={t('bath.day')}>
        {days.map((d) => {
          const [weekday, number] = String(d.label).split(' ');
          return (
            <button key={d.date} type="button" className="day" aria-pressed={current.date === d.date} aria-label={d.label} onClick={() => onDay(d.date)}>
              {weekday}<b>{number}</b>
            </button>
          );
        })}
      </div>
      <div className="slots">
        {current.starts.map((b) => {
          const session = { date: current.date, start: b.start, end: b.end };
          return (
            <button key={keyOf(session)} type="button" className={`slot ${b.eveningMinutes ? 'evening' : 'free'}`} aria-pressed={Boolean(picked && sameSession(picked, session))} onClick={() => onPick(session)}>
              <b>{clockLabel(b.start, lang)} – {clockLabel(b.end, lang)}</b>
              <span>{b.eveningMinutes ? t('bathPlan.withEvening', { n: b.eveningMinutes / 60 }) : t('bathPlan.dayOnly')}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export default function BathPlanPage() {
  const t = useT();
  const navigate = useNavigate();
  const online = useOnline();
  const { id } = useParams();
  const [params] = useSearchParams();
  const { me, lang, reload } = useSession();
  const cart = useCart();
  const shop = useShop();
  const card = (me.bath || []).find((c) => String(c.resourceId) === String(id)) || null;
  const ownedHours = card ? Math.floor(card.ownedMinutes / 60) : 0;
  const minExtra = ownedHours > 0 ? 0 : 1;
  const maxExtra = card ? card.maxExtraHours : 1;
  const [extra, setExtra] = useState(() => Math.max(minExtra, params.get('ajout') ? 1 : 0));
  const target = ownedHours + extra;
  // « À la suite » first when the screen opens on two hours or more; an hour added later never switches the mode under the finger.
  const [chosenMode, setMode] = useState(() => (target >= 2 ? 'suite' : 'spread'));
  const mode = target >= 2 ? chosenMode : 'spread';
  const [picked, setPicked] = useState([]);
  const [block, setBlock] = useState(null);
  const [day, setDay] = useState(null);
  const [refused, setRefused] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const attempt = useRef(null);

  const slots = useLoad(() => (card && mode === 'spread' ? api.slots(card.resourceId) : Promise.resolve(null)), [card && card.resourceId, mode, lang]);
  const blocks = useLoad(() => (card && mode === 'suite' ? api.blocks(card.resourceId, target) : Promise.resolve(null)), [card && card.resourceId, mode, target, lang]);
  useEffect(() => { setBlock(null); }, [target, mode]);
  useEffect(() => { if (picked.length > target) setPicked((cur) => cur.slice(0, target)); }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!refused) return undefined;
    const timer = setTimeout(() => setRefused(null), 4000);
    return () => clearTimeout(timer);
  }, [refused]);

  const sessions = mode === 'suite' ? (block ? [block] : []) : picked;
  const placedHours = sessions.reduce((sum, s) => sum + (Number(s.end.slice(0, 2)) * 60 + Number(s.end.slice(3)) - Number(s.start.slice(0, 2)) * 60 - Number(s.start.slice(3))) / 60, 0);
  const line = card && sessions.length ? { kind: 'resource', id: card.resourceId, sessions } : null;
  const { quote, loading: quoting, error: quoteError } = useLineQuote(line, Boolean(line));
  const quoted = quote && quote.lines && quote.lines[0];
  const unavailable = quoted && quoted.sessions ? quoted.sessions.filter((s) => s.unavailable) : [];
  const selected = useMemo(() => new Set(picked.map(keyOf)), [picked]);
  const shopItem = useMemo(() => {
    if (!shop.data || !card) return null;
    return shop.data.categories.flatMap((c) => c.items).find((item) => item.scheduling === 'hourly' && String(item.id) === String(card.resourceId)) || null;
  }, [shop.data, card]);

  const bar = <AppBar title={card ? card.name : t('bath.title')} back="/" />;
  if (!online && !card) return <NeedNetwork title={t('bath.title')} back="/" />;
  if (!card) return <div className="scroll enter">{bar}<div className="pad"><EmptyState icon="bath" title={t('bath.none')} /></div></div>;

  const toggle = (slot, date) => {
    const session = { date, start: slot.start, end: slot.end };
    const key = slotKey(date, slot);
    if (selected.has(key)) { setPicked((cur) => cur.filter((s) => keyOf(s) !== key)); setRefused(null); return; }
    // Rule 11 — the count reached: refused in place, with the two ways out.
    if (picked.length >= target) { setRefused(session); return; }
    setPicked((cur) => [...cur, session]);
    setRefused(null);
  };
  const addAndTake = () => {
    if (!refused || extra >= maxExtra) return;
    setExtra((n) => n + 1);
    setPicked((cur) => [...cur, refused]);
    setRefused(null);
  };

  const ready = Boolean(quote) && !quoting && !unavailable.length && placedHours >= Math.max(1, extra) && placedHours <= target;
  const leftToPlace = Math.max(0, ownedHours - Math.max(0, placedHours - extra));

  const confirm = async () => {
    if (!ready) return;
    setError(null);
    if (quote.total > 0) {
      cart.replace(line, shopItem ? cartInfo(shopItem) : { title: card.name, item: { id: card.resourceId, scheduling: 'hourly' } });
      navigate('/panier');
      return;
    }
    setBusy(true);
    attempt.current = attempt.current || newKey();
    try {
      const done = await api.order({ lines: [line], payment: 'none' }, { key: attempt.current });
      attempt.current = null;
      reload();
      navigate(`/commandes/${done.orderId}`);
    } catch (err) {
      attempt.current = null;
      setError(err);
      slots.reload();
      blocks.reload();
    } finally {
      setBusy(false);
    }
  };

  const owned = [
    card.offeredMinutes ? <StatusChip key="o" tone="ok">{t('bathPlan.offered', { n: card.offeredMinutes / 60 })}</StatusChip> : null,
    card.heldMinutes ? <StatusChip key="h" tone="ok">{t('bathPlan.held', { n: card.heldMinutes / 60 })}</StatusChip> : null,
  ].filter(Boolean);

  let body;
  if (mode === 'suite') {
    if (blocks.error) body = <ErrorAlert error={blocks.error} onRetry={blocks.reload} />;
    else if (!blocks.data) body = <Skeleton lines={3} label={t('common.loading')} />;
    else if (!blocks.data.days.length) {
      body = (
        <EmptyState icon="bath" title={t('bathPlan.noBlock', { n: target })}>
          <button type="button" className="btn ghost" onClick={() => setMode('spread')}>{t('bathPlan.spreadInstead')}</button>
        </EmptyState>
      );
    } else body = <Blocks days={blocks.data.days} day={day} onDay={setDay} picked={block} onPick={(s) => setBlock(block && sameSession(block, s) ? null : s)} />;
  } else if (slots.error) body = <ErrorAlert error={slots.error} onRetry={slots.reload} />;
  else if (!slots.data) body = <Skeleton lines={3} label={t('common.loading')} />;
  else if (slots.data.open === false) body = <EmptyState icon="bath" title={slots.data.closedReason} />;
  else {
    const days = slots.data.days || [];
    body = days.length ? (
      <>
        <SlotGrid days={days} day={day || (days.find((d) => d.available) || days[0]).date} onDay={setDay} selected={selected} onToggle={toggle} refusedKey={refused ? keyOf(refused) : null} />
        <div className="counter"><span>{t('bathPlan.chosen')}</span><b>{t('bathPlan.count', { n: picked.length, total: target })}</b></div>
        {refused ? (
          <p className="refuse" role="alert">
            {t('bathPlan.full', { n: target })}
            {extra < maxExtra ? <> <button type="button" onClick={addAndTake}>{t('bathPlan.addOne')}</button>.</> : '.'}
          </p>
        ) : null}
      </>
    ) : <EmptyState icon="bath" title={t('bath.none')} />;
  }

  let label = t('bathPlan.confirmFree');
  if (!line) label = t('bathPlan.pick');
  else if (quoting || (!quote && !quoteError)) label = t('cart.updating');
  else if (quote && quote.total > 0) label = t('bathPlan.confirmPay', { total: quote.totalLabel });

  return (
    <>
      <div className="scroll enter bathplan">
        {bar}
        <div className="pad">
          <p className="eb">{card.eyebrow}</p>
          {owned.length ? <div className="owned">{owned}</div> : null}
          {target >= 2 ? (
            <div>
              <Segmented label={t('bathPlan.mode')} value={mode} onChange={(v) => { setMode(v); setRefused(null); }} options={[{ value: 'suite', label: t('bathPlan.suite') }, { value: 'spread', label: t('bathPlan.spread') }]} />
              <p className="hint seg-help">{mode === 'suite' ? t('bathPlan.suiteHelp', { n: target }) : t('bathPlan.spreadHelp', { n: target })}</p>
            </div>
          ) : null}
          {body}
          <div className="extra">
            <div><b>{t('bathPlan.extra')}</b>{card.priceLine ? <span className="hint">{card.priceLine}</span> : null}</div>
            <QuantityStepper value={extra} min={minExtra} max={maxExtra} onChange={(n) => { setExtra(n); setRefused(null); }} label={t('bathPlan.extra')} />
          </div>
          {unavailable.map((s) => <p key={keyOf(s)} className="hint bad" role="alert">{s.label} · {s.reasonLabel}</p>)}
          {quoted && quoted.breakdown && quoted.breakdown.length ? (
            <div className="quote">
              {quoted.breakdown.map((b) => <div key={b.key}><span>{b.label}</span><b>{b.amountLabel}</b></div>)}
              <div className="tot"><span>{t('bathPlan.due')}</span><b>{quote.totalLabel}</b></div>
            </div>
          ) : null}
          {/* §6.5 « never a dead end » — a quote the server refuses says why, the button stays closed. */}
          {line && quoteError && !quoting ? <Banner tone="bad" role="alert">{quoteError.message || t('err.generic')}</Banner> : null}
          {error ? <Banner tone="bad" role="alert">{error.message || t('err.generic')}</Banner> : null}
        </div>
      </div>
      <div className="sticky-cta">
        {mode === 'spread' && line && leftToPlace > 0 ? <p className="hint" style={{ margin: '0 0 8px' }}>{t('bathPlan.left', { n: leftToPlace })}</p> : null}
        <button type="button" className="btn block" onClick={confirm} disabled={!ready || busy}>{busy ? t('common.loading') : label}</button>
      </div>
    </>
  );
}
