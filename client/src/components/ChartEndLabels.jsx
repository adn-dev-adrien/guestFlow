/**
 * ChartEndLabels — the name of each line written at its last point, on a white halo, pushed apart so
 * two names never overlap (specs/report-grammar.md rule 8). Drawn inside a Recharts chart (it reads the
 * chart's scales); positions only, no figure. Generic: any line chart over a category axis.
 *
 * Props:
 *   items:     Array<{ key, name, color, values: Array<number|null> }>   the visible lines
 *   categories: Array<{ key }>                                           the x axis, in order
 *   band?:     boolean   true when the x axis is a band (bars in the chart): the point sits mid-band
 */
import React from 'react';
import { useXAxisScale, useYAxisScale } from 'recharts';
import { chart } from '../utils/chartColors';
import { lastValueIndex, layoutEndLabels } from '../utils/reportChart';

export default function ChartEndLabels({ items, categories, band = false }) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  if (!xScale || !yScale) return null;
  const ends = items.map((s) => {
    const i = lastValueIndex(s.values);
    if (i < 0) return null;
    const x = xScale(categories[i].key, band ? { position: 'middle' } : undefined);
    const y = yScale(s.values[i]);
    return x == null || y == null ? null : { key: s.key, x, y, s };
  }).filter(Boolean);
  return (
    <g className="chart-end-labels">
      {layoutEndLabels(ends).map((e) => (
        <g key={e.key}>
          <circle cx={e.x} cy={e.y} r={4} fill={e.s.color} stroke="#fff" strokeWidth={2} />
          <text x={e.x + 9} y={e.labelY} fontSize={11.5} fontWeight={600} fill={chart.value} stroke="#fff" strokeWidth={3} paintOrder="stroke">
            {e.s.name}
          </text>
        </g>
      ))}
    </g>
  );
}
