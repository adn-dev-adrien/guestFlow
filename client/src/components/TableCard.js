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
