/**
 * ChartDataTable — a chart's data as an accessible table, the « Voir en tableau » view
 * (specs/report-grammar.md rule 11): one row per category, one column per series, the same values the
 * chart draws, « — » for a missing one. Generic: any category × series chart.
 *
 * Props:
 *   caption:         string    what the table shows (read by screen readers, visually hidden)
 *   categoryHeader?: string    first column's header, default « Période »
 *   columns:         Array<{ key, label }>
 *   rows:            Array<{ key, label, [columnKey]: number | null }>
 *   formatValue:     (v: number) => string
 *   maxHeight?:      number    scroll height, default 260
 */
import React from 'react';
import { Box, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { visuallyHidden } from '../utils/visuallyHidden';

export default function ChartDataTable({ caption, categoryHeader = 'Période', columns, rows, formatValue, maxHeight = 260 }) {
  return (
    <Box sx={{ maxHeight, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: '12px' }}>
      <Table size="small" stickyHeader>
        <Box component="caption" sx={visuallyHidden}>{caption}</Box>
        <TableHead>
          <TableRow>
            <TableCell scope="col">{categoryHeader}</TableCell>
            {columns.map((c) => <TableCell key={c.key} scope="col" align="right" sx={{ whiteSpace: 'nowrap' }}>{c.label}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell component="th" scope="row">{r.label}</TableCell>
              {columns.map((c) => (
                <TableCell key={c.key} align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {r[c.key] == null ? '—' : formatValue(r[c.key])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
