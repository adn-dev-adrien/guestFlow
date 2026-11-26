/**
 * CashProjectionChart — « Trésorerie de l'exercice » of the Suivi financier
 * (specs/planning/mobile-dashboard-exercise-cash.md rule 18): the cumulative money of an exercise as one line —
 * solid (sapin) for what was received up to today, dashed (miel) for what is still expected — with a
 * date cursor answering « D'ici le … : N € encaissés, dont M € encore attendus », and the monthly
 * received / expected bars on their own small chart underneath (never a second y scale).
 *
 * Feature-agnostic: it only draws the series it is given. Every figure, label and ordering comes from the
 * server (`dashboard.cashProjection`); the component maps them to pixels (axis scale, cursor position) and
 * never adds up money. The cursor answers from the last daily point not after it.
 *
 * Props:
 *   projection:    dashboard.cashProjection (months, daily, today, from, to, end, xMax, todayX, empty…)
 *   formatAmount:  (n) => string   the page's currency format
 *
 * Cursor: drag or tap the curve, tap a month's bar, or type a date. The answer sits above the chart, never
 * under the finger. A visually hidden table repeats the months for assistive technology.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Box, TextField, Typography } from '@mui/material';
import useElementWidth from '../hooks/useElementWidth';
import { chart as c } from '../utils/chartColors';
import { visuallyHidden } from '../utils/visuallyHidden';

const PAD_R = 10;
const FALLBACK_WIDTH = 640;
const LATE = '#A8433A';

// A rounded-up axis maximum with four even steps (the tightest of 1…10 × 10ⁿ that holds the value): pixel layout only.
function niceMax(v) {
  if (!(v > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10].find((k) => k * pow * 4 >= v);
  return step * pow * 4;
}
const kilo = (v) => (v >= 1000 ? `${(Math.round(v / 100) / 10).toLocaleString('fr-FR')} k€` : `${Math.round(v)} €`);
const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export default function CashProjectionChart({ projection, formatAmount }) {
  const [boxRef, measured] = useElementWidth();
  const [cursor, setCursor] = useState(null);
  const [tip, setTip] = useState(null);
  const gesture = useRef(null);

  useEffect(() => { setCursor(null); setTip(null); }, [projection.from, projection.to]);

  if (projection.empty) {
    return <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>Aucun séjour sur cet exercice.</Typography>;
  }

  const phone = (measured || FALLBACK_WIDTH) < 520;
  const W = measured || FALLBACK_WIDTH;
  const padL = phone ? 36 : 48;
  const plotW = Math.max(40, W - padL - PAD_R);
  const xOf = (offset) => padL + (offset / projection.xMax) * plotW;
  const { daily, months } = projection;

  const cursorDate = cursor || projection.end;
  const selected = [...daily].reverse().find((d) => d.date <= cursorDate) || daily[0];

  // Cumulative chart geometry.
  const H = phone ? 220 : 240;
  const top = 16;
  const bottom = 22;
  const h = H - top - bottom;
  const maxV = niceMax(Math.max(...daily.map((d) => d.cumulative)) * 1.04);
  const y = (v) => top + h - (v / maxV) * h;
  // Money only moves on payment days: the lines are steps (across, then up), never a diagonal between two dates.
  const steps = (points, startY, yOf) => points.map((p, i) => (i === 0
    ? `M${xOf(p.x).toFixed(1)},${y(startY(p)).toFixed(1)}${startY(p) === yOf(p) ? '' : ` V${y(yOf(p)).toFixed(1)}`}`
    : `H${xOf(p.x).toFixed(1)} V${y(yOf(p)).toFixed(1)}`)).join(' ');
  const solid = daily.filter((d) => d.solid != null);
  const dashed = daily.filter((d) => d.dashed != null);
  // The dashed line leaves the solid one where it stops, then steps up by what is late or due now.
  const solidPath = steps(solid, (p) => p.solid, (p) => p.solid);
  const dashedPath = steps(dashed, (p) => p.receivedCumulative, (p) => p.dashed);
  const area = (path, points) => `${path} L${xOf(points[points.length - 1].x).toFixed(1)},${y(0)} L${xOf(points[0].x).toFixed(1)},${y(0)} Z`;
  const showToday = projection.todayMonth != null;

  // Bars chart geometry.
  const BH = phone ? 90 : 110;
  const bt = 10;
  const bb = 20;
  const bh = BH - bt - bb;
  const bmax = niceMax(Math.max(...months.map((m) => m.received + m.expected)));
  const by = (v) => bt + bh - (v / bmax) * bh;
  const widthOf = (i) => (i + 1 < months.length ? months[i + 1].x : projection.xMax) - months[i].x;

  const moveTo = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = ((event.clientX - rect.left - padL) / plotW) * projection.xMax;
    const point = [...daily].reverse().find((d) => d.x <= offset) || daily[0];
    setCursor(point.date);
  };
  // A mouse moves the cursor at once. A finger only does on a tap, or once the move is clearly horizontal: a vertical
  // scroll that starts on the chart must never move it.
  const SLOP = 10;
  const onDown = (e) => {
    gesture.current = { x: e.clientX, y: e.clientY, drag: e.pointerType === 'mouse' };
    if (gesture.current.drag) { e.currentTarget.setPointerCapture?.(e.pointerId); moveTo(e); }
  };
  const onMove = (e) => {
    const g = gesture.current;
    if (!g) return;
    if (!g.drag && Math.abs(e.clientX - g.x) > SLOP && Math.abs(e.clientX - g.x) > Math.abs(e.clientY - g.y)) {
      g.drag = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (g.drag) moveTo(e);
  };
  const onUp = (e) => {
    const g = gesture.current;
    gesture.current = null;
    if (g && !g.drag && Math.abs(e.clientX - g.x) <= SLOP && Math.abs(e.clientY - g.y) <= SLOP) moveTo(e);
  };

  const tickEvery = phone ? 2 : 1;

  return (
    <Box ref={boxRef} sx={{ position: 'relative', minWidth: 0 }}>
      <Box
        aria-live="polite"
        data-testid="cash-answer"
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.75, columnGap: 1.25, mb: 1 }}
      >
        <Typography variant="body2" color="text.secondary">
          {cursorDate === projection.end ? <b>{projection.endCaption}</b> : <>D'ici le <b>{longDate(cursorDate)}</b></>}
        </Typography>{' '}
        <Typography component="span" sx={{ fontSize: '1.35rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatAmount(selected.cumulative)}</Typography>{' '}
        <Typography variant="body2" color="text.secondary">
          encaissés{selected.expectedCumulative > 0 ? <>, dont <b>{formatAmount(selected.expectedCumulative)}</b> encore attendus</> : null}
        </Typography>
        <TextField
          size="small"
          type="date"
          label="Date"
          value={cursorDate}
          onChange={(e) => e.target.value && setCursor(e.target.value)}
          slotProps={{ htmlInput: { min: projection.from, max: projection.end }, inputLabel: { shrink: true } }}
          sx={{ ml: { sm: 'auto' }, minWidth: 150 }}
        />
      </Box>

      <Box sx={{ position: 'relative' }}>
      <svg width={W} height={H} role="img" aria-label="Trésorerie cumulée de l'exercice" style={{ display: 'block', touchAction: 'pan-y' }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={padL} x2={W - PAD_R} y1={y((maxV * i) / 4)} y2={y((maxV * i) / 4)} stroke={c.grid} />
            <text x={padL - 6} y={y((maxV * i) / 4) + 4} textAnchor="end" fontSize={10.5} fill={c.tick}>{kilo((maxV * i) / 4)}</text>
          </g>
        ))}
        {months.map((m, i) => (i % tickEvery === 0 ? (
          <text key={m.key} x={xOf(m.x + widthOf(i) / 2)} y={H - 6} textAnchor="middle" fontSize={10.5} fill={c.tick} opacity={m.inWindow ? 1 : 0.45}>{m.label}</text>
        ) : null))}
        {months.some((m) => m.key === 'after') && (
          <rect x={xOf(months[months.length - 1].x)} y={top} width={xOf(projection.xMax) - xOf(months[months.length - 1].x)} height={h} fill={c.band} />
        )}
        {solid.length > 1 && <path d={area(solidPath, solid)} fill="rgba(47,93,70,.08)" />}
        {dashed.length > 1 && <path d={area(dashedPath, dashed)} fill="rgba(176,127,46,.08)" />}
        {dashed.length > 0 && <path d={dashedPath} fill="none" stroke={c.upcoming} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />}
        {solid.length > 1 && <path d={solidPath} fill="none" stroke={c.current} strokeWidth={2.2} strokeLinejoin="round" />}
        {showToday && (
          <g data-testid="cash-today">
            <line x1={xOf(projection.todayX)} x2={xOf(projection.todayX)} y1={top} y2={y(0)} stroke={c.today} strokeDasharray="2 3" />
            <text x={xOf(projection.todayX) + (projection.todayX > projection.xMax / 2 ? -4 : 4)} y={top + 9} textAnchor={projection.todayX > projection.xMax / 2 ? 'end' : 'start'} fontSize={10.5} fill="#6F5112">Aujourd'hui</text>
          </g>
        )}
        <line x1={xOf(selected.x)} x2={xOf(selected.x)} y1={top} y2={y(0)} stroke={c.value} data-testid="cash-cursor" />
        <circle cx={xOf(selected.x)} cy={y(selected.cumulative)} r={5.5} fill="#fff" stroke={c.value} strokeWidth={2} />
        <rect
          x={padL} y={0} width={plotW} height={H} fill="transparent" style={{ cursor: 'ew-resize' }} data-testid="cash-hit"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => { gesture.current = null; }}
        />
      </svg>

      <svg width={W} height={BH} role="img" aria-label="Trésorerie par mois" style={{ display: 'block', marginTop: 4 }}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W - PAD_R} y1={by(bmax * f)} y2={by(bmax * f)} stroke={c.grid} />
            <text x={padL - 6} y={by(bmax * f) + 4} textAnchor="end" fontSize={10.5} fill={c.tick}>{kilo(bmax * f)}</text>
          </g>
        ))}
        {months.map((m, i) => {
          const colW = (widthOf(i) / projection.xMax) * plotW;
          const bw = Math.max(4, colW * 0.62);
          const cx = xOf(m.x + widthOf(i) / 2);
          let base = 0;
          const parts = [[m.received, c.current], [m.late, LATE], [m.upcoming, c.upcoming]].filter(([v]) => v > 0);
          return (
            <g
              key={m.key}
              data-testid={`cash-month-${m.key}`}
              role="button"
              tabIndex={0}
              aria-label={`${m.title} : reçu ${formatAmount(m.received)}, attendu ${formatAmount(m.expected)}`}
              opacity={m.inWindow ? 1 : 0.35}
              style={{ cursor: 'pointer', outline: 'none' }}
              onPointerEnter={() => setTip(m.key)}
              onPointerLeave={() => setTip(null)}
              onFocus={() => setTip(m.key)}
              onBlur={() => setTip(null)}
              onClick={() => { setCursor(m.end); setTip(m.key); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCursor(m.end); } }}
            >
              <rect x={cx - colW / 2} y={0} width={colW} height={BH} fill="transparent" />
              {parts.map(([v, color], j) => {
                const segTop = by(base + v);
                const rect = <rect key={color} x={cx - bw / 2} y={segTop + (j ? 1 : 0)} width={bw} height={Math.max(0, (v / bmax) * bh - (j ? 1 : 0))} fill={color} rx={j === parts.length - 1 ? 3 : 0} />;
                base += v;
                return rect;
              })}
              {i % tickEvery === 0 && <text x={cx} y={BH - 5} textAnchor="middle" fontSize={10.5} fill={c.tick}>{m.label}</text>}
            </g>
          );
        })}
      </svg>

      {tip && (() => {
        const m = months.find((x) => x.key === tip);
        if (!m) return null;
        const i = months.indexOf(m);
        return (
          <Box
            role="status"
            data-testid="cash-tip"
            sx={{
              position: 'absolute', bottom: BH + 4, left: Math.min(Math.max(xOf(m.x + widthOf(i) / 2), 80), W - 80), transform: 'translateX(-50%)',
              bgcolor: c.tooltip, color: '#fff', px: 1.25, py: 0.75, borderRadius: '6px', fontSize: 12, lineHeight: 1.6, whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums', pointerEvents: 'none', zIndex: 1,
            }}
          >
            <b>{m.title}</b><br />Reçu {formatAmount(m.received)}
            {m.late > 0 ? <><br />En retard {formatAmount(m.late)}</> : null}
            <br />Attendu {formatAmount(m.expected)}
          </Box>
        );
      })()}

      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, fontSize: 12, color: 'text.secondary', mt: 1 }}>
        <Legend line={{ borderTop: `3px solid ${c.current}` }}>Encaissé cumulé</Legend>
        <Legend line={{ borderTop: `3px dashed ${c.upcoming}` }}>Projection (encaissé + attendu)</Legend>
        <Legend sq={c.current}>Reçu dans le mois</Legend>
        <Legend sq={c.upcoming}>Attendu dans le mois</Legend>
        <Legend sq={LATE}>En retard</Legend>
      </Box>

      <table style={visuallyHidden}>
        <caption>Trésorerie par mois</caption>
        <thead><tr><th>Mois</th><th>Reçu</th><th>Attendu</th></tr></thead>
        <tbody>
          {months.map((m) => <tr key={m.key}><td>{m.title}</td><td>{formatAmount(m.received)}</td><td>{formatAmount(m.expected)}</td></tr>)}
        </tbody>
      </table>
    </Box>
  );
}

function Legend({ children, line, sq }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      {line ? <Box component="span" sx={{ width: 18, ...line }} /> : <Box component="span" sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: sq }} />}
      {children}
    </Box>
  );
}
