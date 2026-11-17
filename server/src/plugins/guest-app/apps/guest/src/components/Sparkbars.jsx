/**
 * Sparkbars — a row of thin bars from values already scaled 0-1 by the server (a missing value is null, drawn as a
 * hairline). Generic: any 24-bucket series (rain, an hourly count). The last bar is the current one, in ocre.
 *
 * Props: `values` (array of 0-1 | null), `label` (the accessible description), `height` (px, default 64).
 */
export default function Sparkbars({ values, label, height = 64 }) {
  const n = values.length || 1;
  const gap = 3;
  const width = 300;
  const bar = (width - gap * (n - 1)) / n;
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height + 1}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line x1="0" y1={height + 0.5} x2={width} y2={height + 0.5} className="spark-base" />
      {values.map((v, i) => {
        const h = v ? Math.max(3, v * height) : 1.5;
        const cls = v ? (i === n - 1 ? 'spark-now' : 'spark-bar') : 'spark-empty';
        // eslint-disable-next-line react/no-array-index-key
        return <rect key={i} x={i * (bar + gap)} y={height - h} width={bar} height={h} rx="1" className={cls} />;
      })}
    </svg>
  );
}
