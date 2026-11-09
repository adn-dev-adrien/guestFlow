/**
 * « Mes commandes » and one order (rules 35-38, 41ter, §6.6): the current orders first, the past ones folded;
 * the confirmation right after ordering (the gold check drawn once, the server's promise — « Livrée à
 * L'Estiva vers 18 h » / « Prête à 18 h. Lieu de retrait : … »), and the return from Qonto, which polls the
 * order until the payment is confirmed — and, once it has stopped trying, offers « Vérifier à nouveau ».
 */
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import AppBar from '../components/AppBar';
import OrderCard from '../components/OrderCard';
import EmptyState from '../components/EmptyState';
import ErrorAlert from '../components/ErrorAlert';
import Skeleton from '../components/Skeleton';
import { useCart } from '../hooks/useCart';
import { useSession } from '../hooks/useSession';
import { useLoad } from '../hooks/useLoad';
import { useOrderStatus } from '../hooks/useOrderStatus';
import { api } from '../services/api';
import { useT } from '../i18n';

const CURRENT = new Set(['confirmed', 'paid', 'awaiting_payment', 'paid_conflict']);
const STANDING = new Set(['confirmed', 'paid', 'delivered']);

export function OrdersPage() {
  const t = useT();
  const navigate = useNavigate();
  const { lang } = useSession();
  const list = useLoad(() => api.orders(), [lang]);
  const orders = (list.data && list.data.orders) || [];
  const current = orders.filter((o) => CURRENT.has(o.status));
  const past = orders.filter((o) => !CURRENT.has(o.status));
  return (
    <div className="scroll enter">
      <AppBar title={t('orders.title')} />
      <div className="pad">
        {list.error && !list.data ? <ErrorAlert error={list.error} onRetry={list.reload} /> : null}
        {!list.data && !list.error ? <Skeleton lines={4} label={t('common.loading')} /> : null}
        {list.data && !orders.length ? (
          <EmptyState icon="orders" title={t('orders.none')} text={t('orders.noneText')}>
            <button type="button" className="btn ghost" onClick={() => navigate('/boutique')}>{t('cart.seeShop')}</button>
          </EmptyState>
        ) : null}
        {current.map((o) => <OrderCard key={o.id} order={o} compact onOpen={() => navigate(`/commandes/${o.id}`)} />)}
        {past.length ? (
          <details open={!current.length}>
            <summary className="lnk" style={{ cursor: 'pointer' }}>{t('orders.past', { n: past.length })}</summary>
            <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
              {past.map((o) => <OrderCard key={o.id} order={o} compact onOpen={() => navigate(`/commandes/${o.id}`)} />)}
            </div>
          </details>
        ) : null}
        {list.data ? (
          <p className="hint">{t('orders.noCancel')} <button type="button" className="btn text" style={{ minHeight: 44, padding: 0 }} onClick={() => navigate('/livret')}>{t('orders.contact')}</button></p>
        ) : null}
      </div>
    </div>
  );
}

export function OrderPage() {
  const t = useT();
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const { lang } = useSession();
  const cart = useCart();
  const {
    order, error, polling, stalled, recheck,
  } = useOrderStatus(id, lang);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const fromPayment = params.get('retour') === '1' || /^\/commande\//.test(window.location.pathname);
  const confirmation = params.get('confirmation') === '1' || fromPayment;

  const recheckButton = <button type="button" className="btn ghost block" onClick={recheck}>{t('order.recheck')}</button>;
  if (error && !order) {
    return <div className="scroll enter"><AppBar title={t('orders.title')} back="/commandes" /><div className="pad"><ErrorAlert error={error} />{recheckButton}</div></div>;
  }
  if (!order && !fromPayment) {
    return <div className="scroll enter"><AppBar title={t('orders.title')} back="/commandes" /><Skeleton lines={5} label={t('common.loading')} /></div>;
  }
  if (!order || (fromPayment && polling)) {
    return (
      <div className="scroll enter">
        <div className="done">
          <div className="spin" role="status" aria-label={t('order.verifying')} />
          <h1>{t('order.verifying')}</h1>
          <p>{t('order.verifyingText')}</p>
        </div>
      </div>
    );
  }

  const abandon = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const out = await api.abandon(order.id);
      if (out.cartLines) cart.restore(out.cartLines);
      navigate('/panier');
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  if (confirmation && STANDING.has(order.status)) {
    return (
      <div className="scroll enter">
        <div className="done">
          <svg className="chk" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" /><path d="M30 52l13 13 27-29" /></svg>
          <h1>{t('order.sent')}</h1>
          {[order.promise, ...(order.extraPromises || []), order.movedNotice].filter(Boolean).map((text) => <p key={text}>{text}</p>)}
          <div style={{ width: '100%', maxWidth: 520, display: 'grid', gap: 12, textAlign: 'left' }}>
            <OrderCard order={order} />
            <button type="button" className="btn ghost block" onClick={() => navigate('/')}>{t('order.home')}</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="scroll enter">
      <AppBar title={t('order.title', { id: order.id })} back="/commandes" />
      <div className="pad">
        {[order.promise, ...(order.extraPromises || []), order.movedNotice].filter(Boolean).map((text) => <p key={text} style={{ margin: 0 }}>{text}</p>)}
        {actionError ? <ErrorAlert error={actionError} /> : null}
        {stalled && order.status === 'awaiting_payment' ? <><p className="hint">{t('order.stalled')}</p>{recheckButton}</> : null}
        <OrderCard
          order={order}
          onAbandon={abandon}
          onResume={order.status === 'awaiting_payment' && order.paymentUrl ? () => window.location.assign(order.paymentUrl) : undefined}
          busy={busy}
        />
      </div>
    </div>
  );
}
