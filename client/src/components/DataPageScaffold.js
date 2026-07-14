/**
 * DataPageScaffold — standard list/CRUD page: sticky PageActionBar (title + labeled create
 * action), optional filter card, scroll-contained table with a shared EmptyState row
 * (specs/ds-components.md §3.4 — this swap gave Clients / Historique emails / Options /
 * Ressources the canonical top bar in one move).
 *
 * Props:
 *   title:        string       page title (PageActionBar)
 *   actionLabel?: string       create CTA label (French) — rendered as a labeled button in the bar
 *   actionIcon?:  ReactNode    CTA icon
 *   onAction?:    () => void   CTA handler
 *   topContent?:  ReactNode    optional filters/summary card above the table
 *   minWidth?:    number       table min width (scrolls inside the card)
 *   head:         ReactNode    <TableRow> of header cells
 *   hasItems:     bool         false → EmptyState row
 *   emptyColSpan: number       colSpan of the EmptyState row
 *   emptyText:    string       French empty message
 *   children:     ReactNode    <TableRow> items
 */
import React from 'react';
import { Box, Button, Card, CardContent, TableBody, TableHead, TableRow, TableCell } from '@mui/material';
import PageActionBar from './PageActionBar';
import TableCard from './TableCard';
import EmptyState from './EmptyState';

export default function DataPageScaffold({
  title,
  actionLabel,
  actionIcon,
  onAction,
  topContent,
  minWidth,
  head,
  hasItems,
  emptyColSpan,
  emptyText,
  children,
}) {
  const actionsBefore = (actionLabel && onAction) ? [{
    node: (
      <Button
        key="scaffold-create"
        variant="contained"
        size="small"
        startIcon={actionIcon}
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    ),
  }] : [];

  return (
    <>
      <PageActionBar title={title} actionsBefore={actionsBefore} />

      <Box sx={{ mt: 2 }}>
        {topContent && (
          <Card sx={{ mb: 3 }}>
            <CardContent sx={{ py: 1.5 }}>
              {topContent}
            </CardContent>
          </Card>
        )}

        <TableCard minWidth={minWidth}>
          <TableHead>{head}</TableHead>
          <TableBody>
            {children}
            {!hasItems && (
              <TableRow>
                <TableCell colSpan={emptyColSpan} sx={{ p: 0, border: 0 }}>
                  <EmptyState message={emptyText} py={4} />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </TableCard>
      </Box>
    </>
  );
}
