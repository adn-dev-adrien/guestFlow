/**
 * OrderCard — one order (rule 38): number, the server's status chip and delivery chip, its lines and their
 * amounts, its notices; in detail the timeline, and for an unpaid card order « Reprendre le paiement » /
 * « Abandonner et revenir au panier ».
 *
 * Props: `order`, `compact` (list row: no timeline), `onOpen`, `onAbandon`, `onResume`, `busy`.
 */
import Icon from './Icon';
import StatusChip from './StatusChip';
import OrderTimeline from './OrderTimeline';
import { useT } from '../i18n';

export function statusTone(status) {
  if (status === 'awaiting_payment') return 'warn';
  if (status === 'paid_conflict') return 'bad';
  if (status === 'expired' || status === 'abandoned') return 'mut';
  return 'ok';
}

export default function OrderCard({ order, compact = false, onOpen, onAbandon, onResume, busy = false }) {
  const t = useT();
  return (
    <article className="ocard" aria-label={t('order.title', { id: order.id })}>
      <header>
        <b>{t('order.title', { id: order.id })}</b>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <StatusChip tone={statusTone(order.status)}>{order.statusLabel}</StatusChip>
          {order.deliveryLabel ? <StatusChip tone={order.status === 'delivered' ? 'ok' : 'mut'}>{order.deliveryLabel}</StatusChip> : null}
        </span>
      </header>
      <ul>
        {order.lines.map((line, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <li key={i}><span>{line.label}</span><span>{line.totalLabel}</span></li>
        ))}
        <li style={{ borderTop: '1px solid var(--line)', paddingTop: 6, marginTop: 4 }}><span>{t('cart.total')}</span><span>{order.totalLabel}</span></li>
      </ul>
      {(order.notices || []).map((n) => <p key={n} className="notice">{n}</p>)}
      {!compact ? <OrderTimeline order={order} /> : null}
      {!compact && order.status === 'awaiting_payment' ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {onResume ? <button type="button" className="btn block" onClick={onResume} disabled={busy}>{t('orders.resume')}</button> : null}
          <button type="button" className="btn ghost block" onClick={onAbandon} disabled={busy}>{t('orders.abandon')}</button>
        </div>
      ) : null}
      {compact ? (
        <button type="button" className="btn text" style={{ justifySelf: 'start', minHeight: 44, padding: 0 }} onClick={onOpen}>
          {t('orders.details')}<Icon name="chev" />
        </button>
      ) : null}
    </article>
  );
}
