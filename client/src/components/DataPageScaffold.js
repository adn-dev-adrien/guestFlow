import React from 'react';
import { Card, CardContent, TableBody, TableHead, TableRow, TableCell } from '@mui/material';
import PageHeader from './PageHeader';
import TableCard from './TableCard';

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
  return (
    <>
      <PageHeader
        title={title}
        actionLabel={actionLabel}
        actionIcon={actionIcon}
        onAction={onAction}
      />

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
              <TableCell colSpan={emptyColSpan} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                {emptyText}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </TableCard>
    </>
  );
}
