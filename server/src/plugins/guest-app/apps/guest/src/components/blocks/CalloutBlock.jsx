/** CalloutBlock — a soft panel with a left icon, info or warning (rule 18 `callout`). */
import Icon from '../Icon';

export default function CalloutBlock({ block }) {
  const warn = block.tone === 'warning' || block.tone === 'warn';
  return (
    <div className={`callout${warn ? ' warn' : ''}`} role={warn ? 'note' : undefined}>
      <Icon name={warn ? 'alert' : 'info'} />
      <div className="ct">{block.title ? <b>{block.title}</b> : null}<p style={{ margin: 0 }}>{block.text}</p></div>
    </div>
  );
}
