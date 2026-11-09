/**
 * CartBody — the cart's content, the same on the phone's cart page and the tablet's cart panel (rules
 * 32-37quater, 41-41ter, §6.6 Cart): the lines with their thumbnails and steppers, the server's total, the
 * delivery / pickup time when a staff item is in it, the payment choice, and one button whose label follows
 * the choice and carries the server's total (« PAYER 33,00 € » / « AJOUTER À MA NOTE · 33,00 € » /
 * « RÉSERVER » at 0 €).
 *
 * Every refusal names the next step (§6.5): a slot taken → back to the slots, sold out → the quantity comes
 * down to what is left, a delivery time gone → the times are asked again.
 *
 * Props: `shop` (the `/shop` payload: `canPayCard`, `canPayNote`, `open`), `inPanel`.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import Photo from './Photo';
import Icon from './Icon';
import QuantityStepper from './QuantityStepper';
import StatusChip from './StatusChip';
import Banner from './Banner';
import EmptyState from './EmptyState';
import DeliveryTimeChips from './DeliveryTimeChips';
import PaymentChoice from './PaymentChoice';
import BreakfastSheet from './BreakfastSheet';
import { lineKey, useCart } from '../hooks/useCart';
import { useSession } from '../hooks/useSession';
import { useOnline } from '../hooks/useOnline';
import { api } from '../services/api';
import { useT } from '../i18n';

/** The quote's line for a cart line: the quote answers the lines in the order they were asked. */
function quotedLine(quote, line, index) {
  if (!quote || !quote.lines) return null;
  const same = quote.lines[index];
  if (same && lineKey(same) === lineKey(line)) return same;
  return quote.lines.find((q) => lineKey(q) === lineKey(line)) || null;
}

/** An Idempotency-Key (§4.3): 128 random bits. */
function newKey() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export default function CartBody({ shop, inPanel = false }) {
  const t = useT();
  const navigate = useNavigate();
  const online = useOnline();
  const { me } = useSession();
  const cart = useCart();
  const [payment, setPayment] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const attempt = useRef(null);
  const { quote } = cart;

  const canCard = Boolean(shop && shop.canPayCard);
  const canNote = Boolean(shop && shop.canPayNote);
  useEffect(() => {
    if (payment === 'card' && !canCard) setPayment(null);
    if (payment === 'note' && !canNote) setPayment(null);
    if (!payment) setPayment(canNote ? 'note' : canCard ? 'card' : null);
  }, [payment, canCard, canNote]);

  if (!cart.lines.length) {
    return (
      <EmptyState icon="shop" title={t('cart.empty')} text={t('cart.emptyText')}>
        {!inPanel ? <button type="button" className="btn ghost" onClick={() => navigate('/boutique')}>{t('cart.seeShop')}</button> : null}
      </EmptyState>
    );
  }

  const quoted = cart.lines.map((line, i) => ({ line, q: quotedLine(quote, line, i) }));
  // A line gone, or a bath session of a line that is no longer free: checkout waits until it is removed (M3).
  const blocked = quoted.some(({ q }) => q && (q.unavailable || (q.sessions || []).some((s) => s.unavailable)));
  const zero = Boolean(quote) && quote.total === 0;
  const fresh = Boolean(quote) && !cart.quoting;
  const needsTime = Boolean(cart.delivery && cart.delivery.needed);
  const why = me.mode !== 'stay' ? t('cart.preArrival')
    : blocked ? t('cart.blocked')
      : !online ? t('net.needed')
        : needsTime && !cart.deliverAt ? t('cart.noDelivery')
          : (shop && shop.open === false && shop.closedReason) || '';
  const pay = zero ? 'none' : payment;
  const disabled = Boolean(why) || !fresh || Boolean(cart.quoteError) || busy || (!zero && !pay);
  const total = quote ? quote.totalLabel : '…';
  const cta = zero ? t('cart.ctaFree') : pay === 'card' ? t('cart.ctaCard', { total }) : t('cart.ctaNote', { total });

  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = { lines: cart.lines, ...(needsTime && cart.deliverAt ? { deliverAt: cart.deliverAt } : {}), payment: pay };
    // The same order sent again (an answer lost on a weak network, a second tap) keeps its key, so the server answers
    // the first order instead of creating another; a changed cart is a new order with a new key.
    const signature = JSON.stringify(body);
    if (!attempt.current || attempt.current.signature !== signature) attempt.current = { signature, key: newKey() };
    try {
      const out = await api.order(body, { key: attempt.current.key });
      attempt.current = null;
      cart.clear();
      if (out.paymentUrl) {
        window.location.assign(out.paymentUrl);
        return;
      }
      navigate(`/commandes/${out.orderId}?confirmation=1`);
    } catch (err) {
      // A network failure, or the first send still being written, keeps the key: the next tap is the same order.
      if (err.code !== 'NETWORK' && err.code !== 'ORDER_IN_PROGRESS') attempt.current = null;
      if (err.code === 'OUT_OF_STOCK' && err.details && err.details.itemKey) cart.lowerTo(err.details.itemKey, Number(err.details.left) || 0, err.message);
      if (err.code === 'DELIVERY_TIME_UNAVAILABLE') cart.refreshDelivery();
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const errorText = error && (error.code === 'NETWORK' ? t('err.network') : error.status === 429 ? t('err.429') : (error.message || t(`err.${error.code}`)));
  const takenResource = error && error.code === 'SLOT_TAKEN' ? cart.lines.find((l) => l.kind === 'resource' && l.sessions) : null;

  return (
    <>
      {error ? (
        <Banner tone="bad" role="alert">
          {errorText}
          {takenResource ? <span className="chiprow"><button type="button" className="chip" onClick={() => navigate(`/boutique/bain/${takenResource.id}`)}>{t('shop.pickSlot')}</button></span> : null}
        </Banner>
      ) : null}
      <div>
        {quoted.map(({ line, q }) => {
          const key = lineKey(line);
          const meta = cart.meta[key] || {};
          const gone = q && q.unavailable;
          const title = (q && q.title) || meta.title || '';
          const note = (q && q.outOfStock && q.outOfStock.label) || cart.stockNotes[key];
          let control;
          if (gone) control = <button type="button" className="btn text" onClick={() => cart.remove(key)}>{t('common.remove')}</button>;
          else if (line.kind === 'option' || (line.kind === 'resource' && !line.sessions)) {
            control = <QuantityStepper small value={line.quantity} min={0} max={meta.max || 99} onChange={(n) => cart.setQuantity(key, n)} label={title} />;
          } else if (line.kind === 'breakfast') {
            control = (
              <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button type="button" className="btn text" onClick={() => setEditing(line)}>{t('common.edit')}</button>
                <button type="button" className="x" aria-label={`${t('common.remove')} ${title}`} onClick={() => cart.remove(key)}><Icon name="trash" /></button>
              </span>
            );
          } else control = <button type="button" className="x" aria-label={`${t('common.remove')} ${title}`} onClick={() => cart.remove(key)}><Icon name="trash" /></button>;
          return (
            <div className={`cline${gone ? ' gone' : ''}`} key={key}>
              <Photo src={meta.imageUrl} imgSizes="54px" />
              <div className="ct">
                <b>{title}</b>
                {gone ? <span>{q.unavailableReason}</span> : null}
                {!gone && q && line.kind === 'resource' && q.sessions ? q.sessions.filter((s) => !s.unavailable).map((s) => <span key={`${s.date}${s.start}`}>{s.label}</span>) : null}
                {!gone && q && line.kind === 'breakfast' ? <span>{q.label}</span> : null}
                {!gone ? <span className="fig" style={{ fontSize: 13 }}>{q ? q.totalLabel : '…'}</span> : null}
                {!gone && q && q.sessions ? q.sessions.filter((s) => s.unavailable).map((s) => (
                  <span key={`${s.date}${s.start}`} className="hint bad gone-session">
                    <span>{s.label} · {s.reasonLabel}</span>
                    <button type="button" className="x" aria-label={`${t('common.remove')} ${s.label}`} onClick={() => cart.removeSession(key, s)}><Icon name="trash" /></button>
                  </span>
                )) : null}
                {!gone && note ? <span style={{ marginTop: 3, display: 'inline-flex' }}><StatusChip tone="warn">{note}</StatusChip></span> : null}
              </div>
              {control}
            </div>
          );
        })}
      </div>
      <div className={`total${cart.quoting ? ' quoting' : ''}`} aria-live="polite" aria-busy={cart.quoting}>
        <span>{t('cart.total')}</span><b>{total}</b>
      </div>
      {cart.quoteError && cart.quoteError.code !== 'NETWORK' ? <Banner tone="bad" role="alert">{cart.quoteError.message || t('err.generic')}</Banner> : null}
      {zero && !blocked ? <Banner tone="ok">{t('cart.free')}</Banner> : null}
      {needsTime ? <DeliveryTimeChips delivery={cart.delivery} value={cart.deliverAt} onChange={cart.setDeliverAt} /> : null}
      {!zero && me.mode === 'stay' ? <PaymentChoice canNote={canNote} canCard={canCard} value={payment} onChange={setPayment} /> : null}
      {why ? <p className="hint bad">{why}</p> : null}
      <button type="button" className="btn block" disabled={disabled} onClick={submit} aria-busy={busy || cart.quoting}>{cta}</button>
      {editing ? (
        <BreakfastSheet
          item={cart.meta[lineKey(editing)] && cart.meta[lineKey(editing)].item}
          partySize={me.stay ? me.stay.partySize : 1}
          open={Boolean(editing)}
          initial={editing}
          onClose={() => setEditing(null)}
          onAdd={(line) => { cart.replace(line); setEditing(null); }}
        />
      ) : null}
    </>
  );
}
