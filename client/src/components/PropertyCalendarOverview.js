import React, { useMemo } from 'react';
import { Box, Card, CardContent, Typography } from '@mui/material';

export function buildOverviewDays(count = 30, fromDate = new Date()) {
  const base = new Date(fromDate);
  const days = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

export default function PropertyCalendarOverview({
  title,
  properties,
  reservations,
  platformColors,
  daysCount = 30,
  fromDate,
  onPropertySelect,
}) {
  const days = useMemo(() => buildOverviewDays(daysCount, fromDate), [daysCount, fromDate]);

  const handleSelect = (property) => {
    if (onPropertySelect) onPropertySelect(property);
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        {title && <Typography variant="h6" gutterBottom>{title}</Typography>}
        <Box sx={{ overflowX: 'auto' }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: `180px repeat(${days.length}, minmax(36px, 1fr))`,
              gap: 0.5,
              minWidth: days.length * 38 + 180,
            }}
          >
            <Box sx={{ fontWeight: 600, py: 1 }}>Logement</Box>
            {days.map((d) => {
              const date = new Date(d);
              return (
                <Box key={d} sx={{ textAlign: 'center', fontSize: 10, py: 1, color: 'text.secondary' }}>
                  <Box>{date.getDate()}</Box>
                  <Box>{['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'][date.getDay()]}</Box>
                </Box>
              );
            })}

            {properties.map((prop) => (
              <React.Fragment key={prop.id}>
                <Box
                  sx={{
                    py: 1,
                    px: 0.5,
                    fontWeight: 500,
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    cursor: onPropertySelect ? 'pointer' : 'default',
                    textDecoration: onPropertySelect ? 'underline' : 'none',
                    textDecorationStyle: onPropertySelect ? 'dotted' : 'solid',
                  }}
                  onClick={() => handleSelect(prop)}
                  title={onPropertySelect ? 'Ouvrir le calendrier complet de ce logement' : ''}
                >
                  {prop.name}
                </Box>
                {days.map((d) => {
                  const res = reservations.find((r) => r.propertyId === prop.id && d >= r.startDate && d < r.endDate);
                  return (
                    <Box
                      key={`${prop.id}-${d}`}
                      onClick={() => handleSelect(prop)}
                      sx={{
                        borderRadius: 0.5,
                        bgcolor: res ? (platformColors[res.platform] || '#757575') : 'grey.100',
                        minHeight: 28,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: onPropertySelect ? 'pointer' : 'default',
                      }}
                      title={res ? `${res.firstName} ${res.lastName} (${res.platform})` : ''}
                    />
                  );
                })}
              </React.Fragment>
            ))}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
