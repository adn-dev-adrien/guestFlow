/**
 * ChannelBreakdownCard — « Canaux de réservation » of the Finance page
 * (specs/site-traffic-analytics.md rules 21-23). Feature-local: it renders the server's
 * `revenueByChannel` / `yearToDateByChannel` payload as is — every figure, subtotal, total and rate
 * comes from the server. A table from `sm` up, one card per channel on a phone.
 *
 * Props:
 *   breakdown: { site: { rows, subtotal }, others, total } | undefined
 *   caption:   string   the window the figures cover
 */
import React from 'react';
import {
  Box, Card, CardContent, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import EmptyState from './EmptyState';
import { formatCurrencyRounded } from '../utils/formatters';

const rate = (r) => (r.conversionRate == null ? '—' : `${String(r.conversionRate).replace('.', ',')} %`);
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function DesktopRow({ row, indent, strong }) {
  const sx = strong ? { fontWeight: 700 } : undefined;
  const site = row.requests !== undefined;
  return (
    <TableRow>
      <TableCell sx={{ ...sx, pl: indent ? 4 : 2 }}>{row.label}</TableCell>
      <TableCell align="right" sx={sx}>{row.reservations}</TableCell>
      <TableCell align="right" sx={sx}>{row.nights}</TableCell>
      <TableCell align="right" sx={sx}>{formatCurrencyRounded(row.revenue)}</TableCell>
      <TableCell align="right" sx={sx}>{site ? row.requests : '—'}</TableCell>
      <TableCell align="right" sx={sx}>{site ? rate(row) : '—'}</TableCell>
    </TableRow>
  );
}

function MobileCard({ label, row }) {
  const site = row.requests !== undefined;
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
      <Typography variant="h6" sx={{ lineHeight: 1.3 }}>{formatCurrencyRounded(row.revenue)}</Typography>
      <Typography variant="caption" color="text.secondary" component="div">
        {plural(row.reservations, 'résa')} · {plural(row.nights, 'nuit')}
        {site && ` · ${plural(row.requests, 'demande')} · ${rate(row)} convertis`}
      </Typography>
    </Box>
  );
}

export default function ChannelBreakdownCard({ breakdown, caption }) {
  const siteRows = breakdown?.site?.rows || [];
  const others = breakdown?.others || [];
  const empty = siteRows.length === 0 && others.length === 0;
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="sectionHeader">Canaux de réservation</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>{caption}</Typography>
        {empty ? (
          <EmptyState message="Aucune réservation sur la période." py={2} />
        ) : (
          <>
            <Box sx={{ display: { xs: 'none', sm: 'block' }, overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Canal</TableCell>
                    <TableCell align="right">Résas</TableCell>
                    <TableCell align="right">Nuits</TableCell>
                    <TableCell align="right">CA</TableCell>
                    <TableCell align="right">Demandes</TableCell>
                    <TableCell align="right">Conversion</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {siteRows.length > 0 && (
                    <>
                      <TableRow>
                        <TableCell colSpan={6} sx={{ bgcolor: 'action.hover', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                          Site internet
                        </TableCell>
                      </TableRow>
                      {siteRows.map((r) => <DesktopRow key={r.key} row={r} indent />)}
                      <DesktopRow row={{ ...breakdown.site.subtotal, label: 'Sous-total site' }} indent strong />
                    </>
                  )}
                  {others.map((r) => <DesktopRow key={r.key} row={r} />)}
                  <DesktopRow row={{ ...breakdown.total, label: 'Total' }} strong />
                </TableBody>
              </Table>
            </Box>
            <Stack spacing={1} sx={{ display: { xs: 'flex', sm: 'none' } }}>
              {siteRows.map((r) => <MobileCard key={r.key} label={`Site · ${r.label}`} row={r} />)}
              {others.map((r) => <MobileCard key={r.key} label={r.label} row={r} />)}
              <MobileCard label="Total" row={breakdown.total} />
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
