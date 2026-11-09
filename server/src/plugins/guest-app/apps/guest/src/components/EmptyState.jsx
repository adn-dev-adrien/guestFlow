/**
 * EmptyState — icon, one sentence, one action (§6.4 « States »). No illustration.
 *
 * Props: `icon`, `title`, `text`, `children` (the action).
 */
import Icon from './Icon';

export default function EmptyState({ icon = 'info', title, text, children }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      {title ? <b>{title}</b> : null}
      {text ? <span>{text}</span> : null}
      {children}
    </div>
  );
}
