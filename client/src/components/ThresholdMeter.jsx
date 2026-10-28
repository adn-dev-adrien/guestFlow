/**
 * ThresholdMeter — a horizontal meter against a limit: a solid bar to `value`, a hatched extension to
 * `projected`, a tick at `limit`. Past the limit the bars run beyond the tick. Generic: the goal bar,
 * a quota of nights or a turnover ceiling are the same shape; the figures and the tone come from the
 * server. The bars grow from 0 on first render (400 ms), not at all under `prefers-reduced-motion`.
 *
 * Props:
 *   value:      number            the solid part
 *   projected?: number            the hatched part (≥ value); omitted → none
 *   limit:      number            where the tick stands (> 0)
 *   tone?:      'neutral' | 'warning' | 'error'   colour of the bars (default 'neutral' = primary)
 *   limitLabel: string            caption above the tick (« seuil »)
 *   ariaLabel:  string
 *   ariaValueText?: string        the reading in words for assistive tech (e.g. the server's sentence)
 *
 * A negative value is drawn as 0 (nothing to fill).
 */
import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';

const TONE_COLOR = { neutral: 'primary.main', warning: 'warning.main', error: 'error.main' };
const pct = (n, scale) => `${Math.min(100, Math.max(0, (n / scale) * 100)).toFixed(2)}%`;

export default function ThresholdMeter({ value: rawValue, projected: rawProjected, limit, tone = 'neutral', limitLabel, ariaLabel, ariaValueText }) {
  const value = Math.max(0, rawValue);
  const projected = rawProjected == null ? rawProjected : Math.max(0, rawProjected);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const scale = Math.max(limit, projected || 0, value) * 1.05;
  const color = TONE_COLOR[tone] || TONE_COLOR.neutral;
  const grow = { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 99, transition: 'width 400ms cubic-bezier(0.2, 0.8, 0.2, 1)', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } };
  return (
    <Box
      role="meter"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.max(limit, value)}
      aria-valuenow={value}
      aria-valuetext={ariaValueText}
      sx={{ position: 'relative', height: 12, borderRadius: 99, bgcolor: 'action.hover', mt: 3, mb: 1 }}
    >
      {projected != null && projected > value && (
        <Box
          data-testid="meter-projected"
          sx={(t) => ({
            ...grow,
            width: shown ? pct(projected, scale) : 0,
            backgroundImage: `repeating-linear-gradient(135deg, ${alpha(t.palette[color.split('.')[0]].main, 0.38)} 0 5px, ${alpha(t.palette[color.split('.')[0]].main, 0.12)} 5px 10px)`,
          })}
        />
      )}
      <Box data-testid="meter-value" sx={{ ...grow, width: shown ? pct(value, scale) : 0, bgcolor: color }} />
      <Box
        data-testid="meter-limit"
        sx={{ position: 'absolute', top: -6, bottom: -6, width: 2, borderRadius: 1, bgcolor: 'text.primary', left: pct(limit, scale) }}
      >
        <Box component="span" sx={{ position: 'absolute', top: -20, left: 0, transform: 'translateX(-50%)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{limitLabel}</Box>
      </Box>
    </Box>
  );
}
