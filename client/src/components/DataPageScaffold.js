/**
 * DataPageScaffold — standard list/CRUD page: sticky PageActionBar (title + labeled create
 * action), optional filter card, states, and a scroll-contained table with a shared EmptyState
 * (specs/ds-components.md §3.4; states + mobile-cards + barCenter added by
 * specs/ds-sweep-settings.md).
 *
 * Props:
 *   title:        string       page title (PageActionBar)
 *   actionLabel?: string       create CTA label (French) — rendered as a labeled button in the bar
 *   actionIcon?:  ReactNode    CTA icon
 *   onAction?:    () => void   CTA handler
 *   barCenter?:   ReactNode    centered node in the bar (e.g. the tab-wrapper Tabs; hidden on xs)
 *   topContent?:  ReactNode    optional filters/summary card above the table
 *   loading?:     bool         true → LoadingState skeleton instead of the table
 *   error?:       bool|string  truthy → ErrorAlert (message when string) instead of the table
 *   onRetry?:     () => void   « Réessayer » handler for the error state
 *   minWidth?:    number       table min width (scrolls inside the card)
 *   head:         ReactNode    <TableRow> of header cells
 *   hasItems:     bool         false → EmptyState row
 *   emptyColSpan: number       colSpan of the EmptyState row
 *   emptyText:    string       French empty message
 *   children:     ReactNode    <TableRow> items
 *   — Mobile-cards mode (all four together; renders ResponsiveTable instead of the plain table):
 *   items?:            array
 *   getKey?:           (item) => key
 *   renderRow?:        (item) => <TableRow>
 *   renderMobileCard?: (item) => card content (xs)
 */
import React from 'react';
import { Box, Button, Card, CardContent, TableBody, TableHead, TableRow, TableCell } from '@mui/material';
import PageActionBar from './PageActionBar';
import TableCard from './TableCard';
import EmptyState from './EmptyState';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';
import ResponsiveTable from './ResponsiveTable';

export default function DataPageScaffold({
  title,
  actionLabel,
  actionIcon,
  onAction,
  barCenter,
  topContent,
  loading,
  error,
  onRetry,
  minWidth,
  head,
  hasItems,
  emptyColSpan,
  emptyText,
  children,
  items,
  getKey,
  renderRow,
  renderMobileCard,
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

  const mobileCardsMode = Array.isArray(items) && !!renderRow && !!renderMobileCard && !!getKey;

  let body;
  if (loading) {
    body = <LoadingState variant="skeleton" rows={4} />;
  } else if (error) {
    body = <ErrorAlert message={typeof error === 'string' ? error : undefined} onRetry={onRetry} />;
  } else if (mobileCardsMode) {
    body = (
      <ResponsiveTable
        items={items}
        getKey={getKey}
        head={head}
        renderRow={renderRow}
        renderMobileCard={renderMobileCard}
        emptyText={emptyText}
        minWidth={minWidth}
      />
    );
  } else {
    body = (
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
    );
  }

  return (
    <>
      <PageActionBar title={title} center={barCenter} actionsBefore={actionsBefore} />

      <Box sx={{ mt: 2 }}>
        {topContent && (
          <Card sx={{ mb: 3 }}>
            <CardContent sx={{ py: 1.5 }}>
              {topContent}
            </CardContent>
          </Card>
        )}

        {body}
      </Box>
    </>
  );
}
