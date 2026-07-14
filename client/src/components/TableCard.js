/**
 * TableCard — Card-wrapped, scroll-contained table (the TableContainer provides the horizontal
 * scroll on narrow screens — never page-level). For operator-critical lists that need a cards
 * rendering on xs, compose via ResponsiveTable instead.
 *
 * Props: children (TableHead/TableBody), minWidth?, size ('small'), cardSx?.
 */
import React from 'react';
import { Card, TableContainer, Table } from '@mui/material';

export default function TableCard({ children, minWidth, size = 'small', cardSx }) {
  return (
    <Card sx={cardSx}>
      <TableContainer>
        <Table size={size} sx={minWidth ? { minWidth } : undefined}>
          {children}
        </Table>
      </TableContainer>
    </Card>
  );
}
