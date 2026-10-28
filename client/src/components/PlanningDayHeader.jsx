/**
 * PlanningDayHeader — the header of one planning day, sticky just under the page bar while the day's
 * cards scroll beneath it (specs/dashboard-planning-scroll.md rules 16, 17).
 *
 * Props:
 *   label   string   the day, as the server wrote it (« mardi 3 novembre »); set in sans (dates are never
 *                     serif) with its first letter capitalised, the month staying lowercase
 *   isToday boolean  filled `primary`, « — Aujourd'hui » after the label
 *   isPast  boolean  neutral grey with secondary text
 *   done    number   tasks ticked   (specs/planning-day-task-count.md)
 *   total   number   tasks to tick
 *   allDone boolean  a future day whose tasks are all ticked is filled `success`
 *
 * The page bar publishes its bottom edge as `--gf-page-bar-bottom`; the header sticks there. The opaque
 * backdrop keeps the cards from showing through the gap around the pill.
 */
import React from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import TodayIcon from '@mui/icons-material/Today';
import { TODAY_ACTION } from '../constants/planningCopy';

export default function PlanningDayHeader({ label, isToday, isPast, done, total, allDone }) {
  const filled = isToday || (!isPast && allDone);
  const tone = isToday ? 'today' : isPast ? 'past' : allDone ? 'done' : 'upcoming';
  const bgcolor = { today: 'primary.main', past: 'grey.200', done: 'success.main', upcoming: 'grey.200' }[tone];
  const color = filled ? 'common.white' : isPast ? 'text.secondary' : 'text.primary';
  return (
    <Box
      data-testid="planning-day-header"
      sx={{
        position: 'sticky',
        top: 'var(--gf-page-bar-bottom, 64px)',
        zIndex: 3,
        bgcolor: 'background.default',
        pb: 1,
      }}
    >
      <Box
        data-tone={tone}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1, bgcolor, color, borderRadius: 2, px: 2, py: 1,
        }}
      >
        <TodayIcon sx={{ fontSize: 20 }} />
        <Typography
          component="span"
          sx={{ fontWeight: 600, fontSize: '1.05rem', lineHeight: 1.3, minWidth: 0, display: 'inline-block', '&::first-letter': { textTransform: 'uppercase' } }}
        >
          {label}
          {isToday && ` — ${TODAY_ACTION}`}
        </Typography>
        <Chip
          label={`${done}/${total}`}
          size="small"
          sx={(t) => ({
            ml: 'auto',
            bgcolor: alpha(filled ? t.palette.common.white : t.palette.common.black, filled ? 0.25 : 0.08),
            color,
            fontWeight: 700,
            height: 22,
          })}
        />
      </Box>
    </Box>
  );
}
