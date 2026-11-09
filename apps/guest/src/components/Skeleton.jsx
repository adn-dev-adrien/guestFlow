/**
 * Skeleton — the final layout, drawn empty while it loads (§6.4: no spinner on a blank page).
 *
 * Props: `lines` (text lines), `blocks` (card-height boxes), `label` (announced to screen readers).
 */
export default function Skeleton({ lines = 3, blocks = 0, label }) {
  return (
    <div className="pad" role="status" aria-label={label} style={{ paddingTop: 12 }}>
      {Array.from({ length: blocks }, (_, i) => <div key={`b${i}`} className="skel" style={{ height: 156 }} />)}
      {Array.from({ length: lines }, (_, i) => <div key={`l${i}`} className="skel skel-line" style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  );
}
