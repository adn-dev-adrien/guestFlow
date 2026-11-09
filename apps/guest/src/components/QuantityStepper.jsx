/**
 * QuantityStepper — − / count / + (§6.4), 44 px targets. The bounds are the server's (`maxQuantity`, the
 * stock left): the stepper only respects them, the quote and the order judge.
 *
 * Props: `value`, `min` (default 1), `max`, `onChange(next)`, `small`, `label` (what is counted, for screen readers).
 */
import Icon from './Icon';
import { useT } from '../i18n';

export default function QuantityStepper({ value, min = 1, max = 99, onChange, small = false, label }) {
  const t = useT();
  return (
    <div className={`stepper${small ? ' sm' : ''}`} role="group" aria-label={label}>
      <button type="button" aria-label={t('common.less')} disabled={value <= min} onClick={() => onChange(value - 1)}><Icon name="minus" /></button>
      <b aria-live="polite">{value}</b>
      <button type="button" aria-label={t('common.more')} disabled={value >= max} onClick={() => onChange(value + 1)}><Icon name="plus" /></button>
    </div>
  );
}
