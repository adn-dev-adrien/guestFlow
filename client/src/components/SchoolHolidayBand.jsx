import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import { ZONE_COLORS } from '../constants/schoolHolidayZoneColors';
import { displayDate } from '../utils/formatters';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS);
}

/**
 * One colored band for one zone of one period.
 * Positioned absolutely inside its parent lane.
 */
export default function SchoolHolidayBand({ period, zone, schoolYearStart, schoolYearEnd, onClick }) {
  const start = period[`zone${zone}_start`];
  const end = period[`zone${zone}_end`];
  if (!start || !end) return null;

  const totalDays = daysBetween(schoolYearStart, schoolYearEnd) + 1;
  const leftDays = Math.max(0, daysBetween(schoolYearStart, start));
  const widthDays = Math.max(1, daysBetween(start, end) + 1);
  const left = `${(leftDays / totalDays) * 100}%`;
  const width = `${(widthDays / totalDays) * 100}%`;

  const color = ZONE_COLORS[zone] || '#888';
  const tooltipText = (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {period.label} — Zone {zone}
      </Typography>
      <Typography variant="caption">
        {displayDate(start)} → {displayDate(end)}
      </Typography>
      {period.isLocked === 1 ? (
        <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
          🔒 Verrouillée — non touchée par la synchro
        </Typography>
      ) : null}
      {period.externalRef ? (
        <Typography variant="caption" display="block" sx={{ opacity: 0.7 }}>
          Source officielle (data.education.gouv.fr)
        </Typography>
      ) : null}
    </Box>
  );

  return (
    <Tooltip title={tooltipText} arrow placement="top">
      <Box
        onClick={() => onClick && onClick(period)}
        sx={{
          position: 'absolute',
          top: 4,
          height: 'calc(100% - 8px)',
          left,
          width,
          minWidth: 4,
          bgcolor: color,
          borderRadius: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          pr: 0.5,
          transition: 'transform 0.1s, box-shadow 0.1s',
          '&:hover': { transform: 'scaleY(1.06)', boxShadow: 2 },
        }}
      >
        {period.isLocked === 1 ? (
          <LockIcon sx={{ fontSize: 12, color: 'rgba(255,255,255,0.95)' }} />
        ) : null}
      </Box>
    </Tooltip>
  );
}
