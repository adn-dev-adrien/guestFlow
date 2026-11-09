/**
 * ServiceHoursBanner — the service is closed now (rule 42): « Le service reprend demain à 8 h — vous pouvez
 * commander dès maintenant pour plus tard », or closed until the departure. The sentence is the server's.
 *
 * Props: `service` (the shop's `service` or the delivery picker's `bannerLabel`), `label` (overrides).
 */
import Banner from './Banner';

export default function ServiceHoursBanner({ service, label }) {
  const text = label || (service && !service.openNow ? service.bannerLabel : null);
  if (!text) return null;
  return <Banner tone={service && !service.nextOpening && !label ? 'mut' : 'warn'} icon="clock">{text}</Banner>;
}
