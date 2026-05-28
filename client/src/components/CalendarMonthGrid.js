import React from 'react';
import { Card, CardContent, Box, Typography } from '@mui/material';
import { getDaysInMonth, DAY_NAMES, MONTH_NAMES } from '../utils/calendarVisuals';

/**
 * CalendarMonthGrid — the scrollable, infinite month grid: sticky day-name header, padding for the
 * first month's leading weekdays, per-day cells assembled into weeks/rows with vertical month labels
 * and `data-month-anchor` rows for focus-scroll. Pure layout/geometry; each day is rendered via the
 * `renderCell(day, year, month, dim)` callback (the page supplies a keyed <CalendarDayCell>).
 *
 * Props:
 *  - months: { year, month }[]
 *  - scrollRef: ref for the scroll container
 *  - onScroll / onMouseUp / onMouseLeave: container handlers
 *  - renderCell: (day, year, month, dim) => ReactNode (must carry its own key)
 */
export default function CalendarMonthGrid({ months, scrollRef, onScroll, onMouseUp, onMouseLeave, renderCell }) {
  return (
    <Card>
      <CardContent sx={{ p: 1 }}>
        <Box ref={scrollRef} onScroll={onScroll}
          sx={{ height: { xs: 'calc(100vh - 290px)', md: 'calc(100vh - 250px)' }, overflowY: 'auto', overflowX: 'auto', pl: { xs: '8px', sm: '50px' } }}
        >
          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, userSelect: 'none', minWidth: 680 }}
            onMouseLeave={onMouseLeave}
            onMouseUp={onMouseUp}
          >
            {/* Sticky day names */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, position: 'sticky', top: 0, bgcolor: 'background.paper', zIndex: 5 }}>
              {DAY_NAMES.map((d) => (
                <Box key={d} sx={{ textAlign: 'center', fontWeight: 600, py: 1, color: 'text.secondary', fontSize: 14 }}>{d}</Box>
              ))}
            </Box>
            {/* Continuous day cells - organized by week/row */}
            {(() => {
              const cells = [];
              let col = 0;
              const cellMonths = [];

              // Build all cells and track which month each belongs to
              months.forEach(({ year: y, month: m }, mi) => {
                const dim = getDaysInMonth(y, m);
                const fow = new Date(y, m, 1).getDay();
                const af = (fow + 6) % 7;
                if (mi === 0) {
                  for (let i = 0; i < af; i++) {
                    cells.push(<Box key={`pad-${y}-${m}-${i}`} />);
                    cellMonths.push(null);
                    col = (col + 1) % 7;
                  }
                }
                for (let d = 1; d <= dim; d++) {
                  const monthKey = `${y}-${m}`;
                  const cell = renderCell(d, y, m, dim);
                  if (d === 1) {
                    const badgeLabel = `${MONTH_NAMES[m].substring(0, 4)}. ${y}`;
                    cells.push(
                      <Box key={`m${y}-${m}-${d}`} sx={{ position: 'relative' }}>
                        <Box sx={{
                          position: 'absolute', top: 1, left: 1, zIndex: 4, pointerEvents: 'none',
                          bgcolor: 'primary.main', borderRadius: '4px', px: 0.5, py: '1px', lineHeight: 1,
                        }}>
                          <Typography sx={{ fontSize: 9, fontWeight: 700, color: 'white', lineHeight: 1, whiteSpace: 'nowrap' }}>
                            {badgeLabel}
                          </Typography>
                        </Box>
                        {cell}
                      </Box>
                    );
                  } else {
                    cells.push(cell);
                  }
                  cellMonths.push(monthKey);
                  col = (col + 1) % 7;
                }
              });

              // Build rows and track which months appear in which rows
              const rows = [];
              const monthRowMap = {}; // monthKey -> array of row indices
              let currentRow = [];
              let currentRowMonthKey = null;

              cells.forEach((cell, idx) => {
                currentRow.push(cell);
                if (cellMonths[idx]) {
                  currentRowMonthKey = cellMonths[idx];
                }

                if ((idx + 1) % 7 === 0) {
                  // End of week/row
                  const rowIndex = rows.length;
                  if (currentRowMonthKey) {
                    if (!monthRowMap[currentRowMonthKey]) {
                      monthRowMap[currentRowMonthKey] = [];
                    }
                    monthRowMap[currentRowMonthKey].push(rowIndex);
                  }

                  rows.push({ monthKey: currentRowMonthKey, cells: currentRow });
                  currentRow = [];
                  currentRowMonthKey = null;
                }
              });

              // Determine which row should show each month's label (middle row)
              const monthLabelRowMap = {};
              Object.keys(monthRowMap).forEach((monthKey) => {
                const rowIndices = monthRowMap[monthKey];
                const middleIndex = Math.floor((rowIndices[0] + rowIndices[rowIndices.length - 1]) / 2);
                monthLabelRowMap[monthKey] = middleIndex;
              });

              // Render rows with labels
              return rows.map((row, rowIndex) => {
                const shouldShowLabel = row.monthKey && monthLabelRowMap[row.monthKey] === rowIndex;
                const isMonthAnchorRow = row.monthKey && monthRowMap[row.monthKey]?.[0] === rowIndex;
                const [year, month] = row.monthKey ? row.monthKey.split('-').map(Number) : [0, 0];

                return (
                  <Box
                    key={`row-${rowIndex}`}
                    data-month-anchor={isMonthAnchorRow ? row.monthKey : undefined}
                    sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5, position: 'relative' }}
                  >
                    {shouldShowLabel && (
                      <Box sx={{ position: 'absolute', left: -45, top: 0, bottom: 0, width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <Typography sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10, fontWeight: 700, color: 'primary.main', whiteSpace: 'nowrap', lineHeight: 1 }}>
                          {MONTH_NAMES[month].substring(0, 3)} {year}
                        </Typography>
                      </Box>
                    )}
                    {row.cells}
                  </Box>
                );
              });
            })()}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
