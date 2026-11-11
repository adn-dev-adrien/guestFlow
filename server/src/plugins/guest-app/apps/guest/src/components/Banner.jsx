/**
 * Banner — a soft inline message with its icon (`.banner`): service hours, refusals, offers.
 *
 * Props: `tone` ('warn' | 'ok' | 'bad' | 'mut'), `icon`, `role` (e.g. 'alert'), `children`.
 */
import Icon from './Icon';

const DEFAULT_ICON = { warn: 'clock', ok: 'gift', bad: 'alert', mut: 'info' };

export default function Banner({ tone = 'mut', icon, role, children }) {
  return (
    <div className={`banner ${tone}`} role={role}>
      <Icon name={icon || DEFAULT_ICON[tone]} />
      <span>{children}</span>
    </div>
  );
}
