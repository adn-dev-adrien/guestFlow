/**
 * The cart (specs/guest-app.md rules 32, 37quater, 41): local UI state, kept on the device for this stay
 * only. It never adds a price — the total shown is always the server's last answer to
 * `POST /orders/quote`, asked again on every change (debounced), and the delivery times are the server's
 * answer to `POST /shop/delivery-slots`.
 *
 * Line shapes are the API's: `{ kind:'option', id, quantity }`, `{ kind:'resource', id, sessions:[{date,start,end}] }`,
 * `{ kind:'breakfast', id, mornings, time, persons }`. `meta` keeps what the cart draws before the first
 * quote (the item's title and photo).
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { api } from '../services/api';
import { device } from '../services/device';
import { useSession } from './useSession';

const CartContext = createContext(null);
const QUOTE_DELAY_MS = 250;

export const lineKey = (line) => `${line.kind}:${line.id}`;
const sameSession = (a, b) => a.date === b.date && a.start === b.start && a.end === b.end;

/** The number on the cart bar and the tab: units, sessions and breakfast orders — never money. */
export function unitsOf(lines) {
  return lines.reduce((n, l) => n + (l.kind === 'option' ? l.quantity : l.kind === 'resource' ? l.sessions.length : 1), 0);
}

/**
 * Merge a line into the cart: quantities add, up to `max` (the item's bound, when known), sessions join, a
 * breakfast replaces the previous choice.
 */
export function mergeLine(lines, line, max = Infinity) {
  const bound = typeof max === 'number' ? max : Infinity;
  const i = lines.findIndex((l) => lineKey(l) === lineKey(line));
  if (i < 0) return [...lines, line.kind === 'option' ? { ...line, quantity: Math.min(line.quantity, bound) } : line];
  const next = lines.slice();
  const prev = lines[i];
  if (line.kind === 'option') next[i] = { ...prev, quantity: Math.min(prev.quantity + line.quantity, Math.max(prev.quantity, bound)) };
  else if (line.kind === 'resource') next[i] = { ...prev, sessions: [...prev.sessions, ...line.sessions.filter((s) => !prev.sessions.some((p) => sameSession(p, s)))] };
  else next[i] = line;
  return next;
}

export function CartProvider({ children }) {
  const { me, lodging, lang, status } = useSession();
  const anonymous = status === 'unknown' || Boolean(me && me.mode === 'visitor');
  const stayKey = me && me.mode !== 'visitor' && lodging ? `cart:${me.lodging.id}:${me.stay ? me.stay.arrival : ''}` : null;
  const [lines, setLines] = useState([]);
  const [meta, setMeta] = useState({});
  const [deliverAt, setDeliverAt] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const [stockNotes, setStockNotes] = useState({});
  const [deliveryNonce, setDeliveryNonce] = useState(0);
  const loadedKey = useRef(null);
  // The commit that reads a stay's cart back still holds the previous lines: it must not write them over it.
  const justLoaded = useRef(false);
  const seq = useRef(0);

  // The cart belongs to one stay: read it back for that stay, never carry it to another (edge case « stay cancelled mid-cart »).
  useEffect(() => {
    if (loadedKey.current === stayKey) return;
    loadedKey.current = stayKey;
    justLoaded.current = true;
    const saved = stayKey ? device.get(stayKey) : null;
    setLines((saved && saved.lines) || []);
    setMeta((saved && saved.meta) || {});
    setDeliverAt(null);
    setQuote(null);
    setStockNotes({});
  }, [stayKey]);

  // Edge case « stay cancelled mid-cart »: back to the visitor mode (or no session at all), the cart is cleared,
  // on the device too.
  useEffect(() => {
    if (anonymous) device.forget((name) => name.startsWith('cart:'));
  }, [anonymous]);

  useEffect(() => {
    if (justLoaded.current) { justLoaded.current = false; return; }
    if (stayKey && loadedKey.current === stayKey) device.set(stayKey, lines.length ? { lines, meta } : null);
  }, [stayKey, lines, meta]);

  const canQuote = Boolean(me && me.mode === 'stay');

  // Rules 41-42 — the delivery times follow the cart's staff-prepared lines; the first one is preselected.
  const kindsKey = lines.map(lineKey).join(',');
  useEffect(() => {
    if (!canQuote || !lines.length) { setDelivery(null); return undefined; }
    let live = true;
    api.deliverySlots(lines.map(({ kind, id }) => ({ kind, id })))
      .then((d) => {
        if (!live) return;
        setDelivery(d);
        const all = (d.days || []).flatMap((day) => day.slots.map((s) => s.at));
        setDeliverAt((cur) => (cur && all.includes(cur) ? cur : ((d.asap && d.asap.at) || all[0] || null)));
      })
      .catch(() => { if (live) setDelivery(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindsKey, canQuote, lang, deliveryNonce]);

  // Rule 32 — the total is the server's: one quote per settled change.
  const body = JSON.stringify({ lines, deliverAt: delivery && delivery.needed ? deliverAt : null });
  useEffect(() => {
    if (!canQuote || !lines.length) { setQuote(null); setQuoteError(null); return undefined; }
    const mine = ++seq.current;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const parsed = JSON.parse(body);
        const q = await api.quote(parsed.lines, parsed.deliverAt);
        if (mine !== seq.current) return;
        setQuote(q);
        setQuoteError(null);
        // Rule 37quater — a line beyond what is left comes back lowered, the cart says how many are left; a line
        // with nothing left stays, struck « Épuisé » by the server, for the guest to remove.
        const lowered = (q.lines || []).filter((l) => l.outOfStock && typeof l.quantity === 'number' && l.outOfStock.left > 0 && l.outOfStock.left < l.quantity);
        if (lowered.length) {
          setStockNotes((n) => ({ ...n, ...Object.fromEntries(lowered.map((l) => [lineKey(l), l.outOfStock.label])) }));
          setLines((cur) => cur
            .map((c) => {
              const hit = lowered.find((l) => lineKey(l) === lineKey(c));
              return hit && c.kind === 'option' ? { ...c, quantity: Math.max(0, hit.outOfStock.left) } : c;
            })
            .filter((c) => c.kind !== 'option' || c.quantity > 0));
        }
      } catch (err) {
        // M1 — a total that no longer matches the cart is never shown nor ordered: no quote until one succeeds.
        if (mine === seq.current) { setQuote(null); setQuoteError(err); }
      } finally {
        if (mine === seq.current) setQuoting(false);
      }
    }, QUOTE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [body, canQuote, lang]);

  const remember = useCallback((key, info) => setMeta((m) => ({ ...m, [key]: { ...(m[key] || {}), ...info } })), []);

  const add = useCallback((line, info) => {
    setLines((cur) => mergeLine(cur, line, info && info.max));
    if (info) remember(lineKey(line), info);
  }, [remember]);

  const setQuantity = useCallback((key, quantity) => {
    setLines((cur) => cur.map((l) => (lineKey(l) === key ? { ...l, quantity } : l)).filter((l) => l.kind !== 'option' || l.quantity > 0));
    setStockNotes((n) => { const { [key]: _drop, ...rest } = n; return rest; });
  }, []);

  const replace = useCallback((line, info) => {
    setLines((cur) => {
      const i = cur.findIndex((l) => lineKey(l) === lineKey(line));
      if (i < 0) return [...cur, line];
      const next = cur.slice();
      next[i] = line;
      return next;
    });
    if (info) remember(lineKey(line), info);
  }, [remember]);

  const remove = useCallback((key) => {
    setLines((cur) => cur.filter((l) => lineKey(l) !== key));
    setStockNotes((n) => { const { [key]: _drop, ...rest } = n; return rest; });
  }, []);

  const removeSession = useCallback((key, session) => {
    setLines((cur) => cur
      .map((l) => (lineKey(l) === key ? { ...l, sessions: l.sessions.filter((s) => !sameSession(s, session)) } : l))
      .filter((l) => l.kind !== 'resource' || l.sessions.length));
  }, []);

  /** A delivery time refused at order time (`DELIVERY_TIME_UNAVAILABLE`): ask the server for the times again. */
  const refreshDelivery = useCallback(() => { setDeliverAt(null); setDeliveryNonce((n) => n + 1); }, []);

  /** Rule 37quater — `OUT_OF_STOCK { itemKey, left }`: the line comes down to what is left. */
  const lowerTo = useCallback((key, left, label) => {
    if (left > 0) setLines((cur) => cur.map((l) => (lineKey(l) === key && l.kind === 'option' ? { ...l, quantity: left } : l)));
    if (label) setStockNotes((n) => ({ ...n, [key]: label }));
  }, []);

  const clear = useCallback(() => { setLines([]); setDeliverAt(null); setStockNotes({}); }, []);

  /** Rule 35 — an abandoned card order gives its lines back, merged into what the cart holds since. */
  const restore = useCallback((cartLines) => {
    setLines((cur) => (cartLines || []).reduce((all, line) => mergeLine(all, line), cur));
  }, []);

  const value = useMemo(() => ({
    lines,
    meta,
    count: unitsOf(lines),
    quote,
    quoting,
    quoteError,
    delivery,
    deliverAt,
    stockNotes,
    setDeliverAt,
    add,
    replace,
    setQuantity,
    remove,
    removeSession,
    clear,
    restore,
    remember,
    refreshDelivery,
    lowerTo,
  }), [lines, meta, quote, quoting, quoteError, delivery, deliverAt, stockNotes, add, replace, setQuantity, remove, removeSession, clear, restore, remember, refreshDelivery, lowerTo]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
