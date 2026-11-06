/**
 * ChartEndLabels — the name of each line written at its last point, on a white halo, pushed apart so
 * two names never overlap and kept inside the plot (specs/report-grammar.md rules 8, 22). Drawn inside
 * a Recharts chart (it reads the chart's scales and plot area); positions only, no figure. A name
 * wider than `maxWidth` is cut with « … », the full name in its `<title>`. Generic: any line chart over
 * a category axis.
 *
 * Props:
 *   items:      Array<{ key, name, color, values: Array<number|null> }>   the visible lines
 *   categories: Array<{ key }>                                           the x axis, in order
 *   band?:      boolean   true when the x axis is a band (bars in the chart): the point sits mid-band
 *   maxWidth?:  number    room right of the plot for a name (the chart's right margin)
 */
import React from 'react';
import { usePlotArea, useXAxisScale, useYAxisScale } from 'recharts';
import { chart } from '../utils/chartColors';
import { fitEndLabel, lastValueIndex, layoutEndLabels } from '../utils/reportChart';

export default function ChartEndLabels({ items, categories, band = false, maxWidth = Infinity }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!xScale || !yScale) return null;
  const ends = items.map((s) => {
    const i = lastValueIndex(s.values);
    if (i < 0) return null;
    const x = xScale(categories[i].key, band ? { position: 'middle' } : undefined);
    const y = yScale(s.values[i]);
    return x == null || y == null ? null : { key: s.key, x, y, s };
  }).filter(Boolean);
  const bounds = plot ? { top: plot.y + 8, bottom: plot.y + plot.height - 4 } : {};
  return (
    <g className="chart-end-labels">
      {layoutEndLabels(ends, 15, 4, bounds).map((e) => {
        const room = plot ? plot.x + plot.width + maxWidth - (e.x + 9) : maxWidth;
        const text = fitEndLabel(e.s.name, room + 16);
        return (
          <g key={e.key}>
            <circle cx={e.x} cy={e.y} r={4} fill={e.s.color} stroke="#fff" strokeWidth={2} />
            <text x={e.x + 9} y={e.labelY} fontSize={11.5} fontWeight={600} fill={chart.value} stroke="#fff" strokeWidth={3} paintOrder="stroke">
              {text !== String(e.s.name) && <title>{e.s.name}</title>}
              {text}
            </text>
          </g>
        );
      })}
    </g>
  );
}
