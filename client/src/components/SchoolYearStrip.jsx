import React from 'react';
import { Card, CardContent, Typography, Box } from '@mui/material';
import SchoolHolidayBand from './SchoolHolidayBand';
import { ZONE_COLORS, ZONE_KEYS } from '../constants/schoolHolidayZoneColors';

const MONTH_LABELS = ['Sep', 'Oct', 'Nov', 'Déc', 'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jui', 'Aoû'];
const LANE_LABEL_WIDTH = 60;
const LANE_HEIGHT = 34;

export default function SchoolYearStrip({ schoolYear, periods, onEdit }) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2 }}>{schoolYear.label}</Typography>

        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: 720, position: 'relative' }}>
            {/* Month axis */}
            <Box sx={{ display: 'flex', mb: 1, pl: `${LANE_LABEL_WIDTH}px` }}>
              {MONTH_LABELS.map((m) => (
                <Box
                  key={m}
                  sx={{
                    flex: 1,
                    textAlign: 'center',
                    fontSize: 11,
                    color: 'text.secondary',
                    borderLeft: '1px solid',
                    borderColor: 'grey.200',
                    py: 0.25,
                  }}
                >
                  {m}
                </Box>
              ))}
            </Box>

            {/* Zone lanes */}
            {ZONE_KEYS.map((zone) => (
              <Box key={zone} sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                <Box
                  sx={{
                    width: LANE_LABEL_WIDTH,
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: ZONE_COLORS[zone],
                    pr: 1,
                  }}
                >
                  Zone {zone}
                </Box>
                <Box
                  sx={{
                    flex: 1,
                    height: LANE_HEIGHT,
                    bgcolor: 'grey.100',
                    borderRadius: 1,
                    position: 'relative',
                    borderLeft: '1px solid',
                    borderColor: 'grey.200',
                  }}
                >
                  {periods.map((period) => (
                    <SchoolHolidayBand
                      key={`${period.id}-${zone}`}
                      period={period}
                      zone={zone}
                      schoolYearStart={schoolYear.start}
                      schoolYearEnd={schoolYear.end}
                      onClick={onEdit}
                    />
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
