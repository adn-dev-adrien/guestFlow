/**
 * EnergyCurve — the lodging's last 24 hours of consumption, a smooth line over a soft area, from values already
 * scaled 0-1 by the server (specs/guest-app-home-automation.md rule 18). A missing hour breaks nothing: it is read
 * as the hour before.
 *
 * Props: `values` (array of 0-1 | null), `label`.
 */
export default function EnergyCurve({ values, label }) {
  const width = 300;
  const height = 64;
  const filled = values.reduce((acc, v) => [...acc, v === null ? (acc.length ? acc[acc.length - 1] : 0) : v], []);
  if (filled.length < 2) return null;
  const step = width / (filled.length - 1);
  const pts = filled.map((v, i) => [i * step, height - v * (height - 6)]);
  const line = pts.reduce((d, [x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [x0, y0] = pts[i - 1];
    const cx = (x0 + x) / 2;
    return `${d} C${cx},${y0} ${cx},${y} ${x},${y}`;
  }, '');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height + 4}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={`${line} L${width},${height} L0,${height}Z`} className="curve-area" />
      <path d={line} className="curve-line" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r="3.5" className="spark-now" />
    </svg>
  );
}
