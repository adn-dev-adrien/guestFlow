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
 *   cardsBelow?:      'sm' | 'md' | 'lg'          breakpoint under which the cards replace the table
 *                                                 (default 'sm'; a wide table raises it)
 *   cardsBelowWidth?: number                      the cards also replace the table whenever the
 *                                                 CONTAINER is narrower than this (px) — a wide table
 *                                                 next to the drawer must not hide its last columns
 *                                                 in a scroller nobody notices (2026-10-27 audit)
 */
import React, { useLayoutEffect, useRef, useState } from 'react';
import { Box, Card, CardContent, Stack, TableBody, TableHead, useMediaQuery } from '@mui/material';
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
  cardsBelow = 'sm',
  cardsBelowWidth,
}) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down(cardsBelow));
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!cardsBelowWidth || !el) return undefined;
    const measure = () => setContainerWidth(el.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cardsBelowWidth]);

  // A zero width (jsdom, a hidden tab) is « unknown », not « narrow ».
  const tooNarrow = Boolean(cardsBelowWidth) && containerWidth > 0 && containerWidth < cardsBelowWidth;
  const showCards = (isXs || tooNarrow) && Boolean(renderMobileCard);

  let content;
  if (!items.length) {
    content = <EmptyState message={emptyText} py={4} />;
  } else if (showCards) {
    content = (
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
  } else {
    content = (
      <TableCard minWidth={minWidth} size={size}>
        <TableHead>{head}</TableHead>
        <TableBody>{items.map((item) => renderRow(item))}</TableBody>
      </TableCard>
    );
  }

  if (!cardsBelowWidth) return content;
  return <Box ref={containerRef} sx={{ minWidth: 0 }}>{content}</Box>;
}
