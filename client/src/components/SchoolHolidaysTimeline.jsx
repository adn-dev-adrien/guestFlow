import React from 'react';
import { Box, Typography } from '@mui/material';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import SchoolYearStrip from './SchoolYearStrip';
import { groupPeriodsBySchoolYear } from '../utils/schoolYear';

export default function SchoolHolidaysTimeline({ periods, onEdit }) {
  const groups = groupPeriodsBySchoolYear(periods);

  if (groups.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
        <EventBusyIcon sx={{ fontSize: 48, opacity: 0.4, mb: 1 }} />
        <Typography variant="body1">
          Aucune période configurée. La prochaine synchronisation automatique se chargera de remplir le calendrier.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {groups.map(({ schoolYear, periods: groupPeriods }) => (
        <SchoolYearStrip
          key={schoolYear.start}
          schoolYear={schoolYear}
          periods={groupPeriods}
          onEdit={onEdit}
        />
      ))}
    </Box>
  );
}
