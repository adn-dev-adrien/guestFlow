/**
 * QuickTile — a 1:1 tile of the home (§6.4): lichen line icon, label, ↗ when it leaves the app. A tile that
 * cannot act yet (the gate before Sowel's key) is drawn but not a button, with its reason.
 *
 * Props: `icon`, `label`, `external`, `disabledReason`, `onClick`.
 */
import Icon from './Icon';

export default function QuickTile({ icon, label, external = false, disabledReason, onClick }) {
  if (disabledReason) {
    return <div className="tile" aria-disabled="true"><Icon name={icon} />{label}<small>{disabledReason}</small></div>;
  }
  return (
    <button type="button" className="tile" onClick={onClick}>
      <Icon name={icon} />
      {label}
      {external ? <Icon name="ext" className="ext" /> : null}
    </button>
  );
}
