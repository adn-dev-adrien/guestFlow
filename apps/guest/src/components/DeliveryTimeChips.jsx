/**
 * DeliveryTimeChips — « Quand souhaitez-vous la recevoir / la récupérer ? » (rules 41, 41bis): the server's
 * delivery times grouped by day, « Dès que possible · vers 17 h 30 » first while the service is open, the
 * closed-service banner above. The question and every label are the server's when it sends them.
 *
 * Props: `delivery` (the `/shop/delivery-slots` payload), `value` (ISO), `onChange(at)`.
 */
import ServiceHoursBanner from './ServiceHoursBanner';
import { useT } from '../i18n';

export default function DeliveryTimeChips({ delivery, value, onChange }) {
  const t = useT();
  const pickup = delivery.mode === 'pickup';
  const question = delivery.question || (pickup ? t('cart.whenPickup') : t('cart.when'));
  const asapAt = delivery.asap ? delivery.asap.at : null;
  return (
    <div className="dgroup" style={{ gap: 10 }}>
      <h2 style={{ fontSize: 17 }}>{question}</h2>
      <ServiceHoursBanner label={delivery.bannerLabel} />
      {(delivery.days || []).map((d) => (
        <div className="dgroup" key={d.date} role="group" aria-label={d.label}>
          <small>{d.label}</small>
          <div className="dchips">
            {d.slots.map((s) => (
              <button key={s.at} type="button" className="chip" aria-pressed={value === s.at} onClick={() => onChange(s.at)}>
                {s.at === asapAt ? delivery.asap.label : s.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {!(delivery.days || []).length ? <p className="hint bad">{t('cart.noDelivery')}</p> : null}
      {delivery.hint ? <p className="hint">{delivery.hint}</p> : null}
    </div>
  );
}
