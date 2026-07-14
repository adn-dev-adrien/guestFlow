/**
 * ResponsiveTable — table on md+, stacked cards on xs (specs/ds-components.md §3.1; CLAUDE.md
 * responsive rule: operator-critical lists must not be scroll-only tables on mobile).
 *
 * Props:
 *   items:            array                       the rows' data
 *   getKey:           (item) => string | number   stable React key
 *   head:             ReactNode                   <TableRow> of header cells (md+)
 *   renderRow:        (item) => ReactNode         <TableRow> for one item (md+)
 *   renderMobileCard: (item) => ReactNode         card CONTENT for one item (xs)
 *   emptyText?:       string                      shown via EmptyState when items is empty
 *   minWidth?:        number                      md+ table min width (scroll-contained)
 *   size?:            'small' | 'medium'          md+ table density (default 'small')
 *   onItemClick?:     (item) => void              row/card click (adds pointer cursor)
 */
import React from 'react';
import { Card, CardContent, Stack, TableBody, TableHead, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import TableCard from './TableCard';
import EmptyState from './EmptyState';

export default function ResponsiveTable({
  items = [],
  getKey,
  head,
  renderRow,
  renderMobileCard,
  emptyText = 'Aucun élément.',
  minWidth,
  size = 'small',
  onItemClick,
}) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));

  if (!items.length) return <EmptyState message={emptyText} py={4} />;

  if (isXs && renderMobileCard) {
    return (
      <Stack spacing={1.5}>
        {items.map((item) => (
          <Card
            key={getKey(item)}
            onClick={onItemClick ? () => onItemClick(item) : undefined}
            sx={onItemClick ? { cursor: 'pointer' } : undefined}
          >
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              {renderMobileCard(item)}
            </CardContent>
          </Card>
        ))}
      </Stack>
    );
  }

  return (
    <TableCard minWidth={minWidth} size={size}>
      <TableHead>{head}</TableHead>
      <TableBody>{items.map((item) => renderRow(item))}</TableBody>
    </TableCard>
  );
}
