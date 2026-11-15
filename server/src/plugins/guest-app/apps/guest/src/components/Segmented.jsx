/**
 * Segmented — a choice between two or more modes, side by side, the chosen one on a thumb that slides to it (§6.3 motion: a
 * transform only, none under reduced motion). Generic: any screen that switches a mode.
 *
 * Props: `options` ([{ value, label }]), `value`, `onChange(value)`, `label` (what is chosen, for screen readers).
 */
export default function Segmented({ options, value, onChange, label }) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="seg" role="group" aria-label={label} style={{ '--seg-n': options.length }}>
      <span className="thumb" aria-hidden="true" style={{ transform: `translateX(${index * 100}%)` }} />
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
