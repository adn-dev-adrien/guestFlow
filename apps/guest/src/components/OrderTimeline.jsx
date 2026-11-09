/**
 * OrderTimeline — an order's steps as a vertical line (§6.4): Reçue → the payment (Payée / Sur votre note /
 * Offerte, or the card still pending) → En préparation → Livrée or Retirée, times in figures. The words of
 * the delivery step are the server's (`deliveryLabel`).
 *
 * Props: `order` (the guest order view).
 */
import { useLang, useT } from '../i18n';
import { instantClock } from '../utils/format';

const LIVE = new Set(['confirmed', 'paid', 'delivered']);

export function timelineSteps(order, t, lang) {
  const steps = [{ state: 'ok', title: t('tl.received'), time: instantClock(order.createdAt, lang) }];
  const s = order.status;
  if (order.payment === 'card') {
    if (s === 'awaiting_payment') steps.push({ state: '', title: t('tl.cardPending') });
    else if (s === 'expired') steps.push({ state: 'bad', title: t('tl.expired') });
    else if (s === 'abandoned') steps.push({ state: 'bad', title: t('tl.abandoned') });
    else if (s === 'paid_conflict') steps.push({ state: 'bad', title: t('tl.conflict') });
    else steps.push({ state: 'ok', title: t('tl.paidCard'), time: order.paidAt ? instantClock(order.paidAt, lang) : '' });
  } else if (order.payment === 'note') steps.push({ state: 'ok', title: t('tl.onNote') });
  else steps.push({ state: 'ok', title: t('tl.free') });
  if (LIVE.has(s) && order.deliverAt) {
    const done = s === 'delivered';
    const pickup = order.fulfilment === 'pickup';
    steps.push({ state: done ? 'ok' : '', title: t('tl.preparing'), text: order.deliveryLabel || '' });
    steps.push({ state: done ? 'ok' : '', title: pickup ? t('tl.collected') : t('tl.delivered'), text: pickup ? order.pickupPlace || '' : '' });
  }
  return steps;
}

export default function OrderTimeline({ order }) {
  const t = useT();
  const lang = useLang();
  return (
    <ol className="timeline" style={{ margin: 0, listStyle: 'none' }}>
      {timelineSteps(order, t, lang).map((step) => (
        <li key={step.title} className={`tl${step.state ? ` ${step.state}` : ''}`}>
          <i aria-hidden="true" />
          <div><b>{step.title}</b>{step.text ? <span>{step.text}</span> : null}</div>
          <time>{step.time || ''}</time>
        </li>
      ))}
    </ol>
  );
}
