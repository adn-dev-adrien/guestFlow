/**
 * SaleDetailList — the lines a stay sold, as the server's `saleDetail` payload gives them (specs/pricing-components.md §3 rule 31).
 *
 * Props: `detail` (the payload: `lines[]`, `buckets`, `totals`), `onChangeMoment(line, collectAt)` (optional: shows a « moment » menu on
 * an unpaid line), `busyRef` (the ref of the line being changed). Nothing is computed here: amounts are the server's cents, labels the
 * server's French. Lines stack on a phone, two columns from `sm`.
 */
import React, { useState } from 'react';
import { Box, Button, Chip, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { formatCurrency } from '../utils/formatters';
import { MOMENT_CHOICES } from '../constants/extraSale';

const euros = (cents) => formatCurrency((Number(cents) || 0) / 100);
const STATUS_COLOR = { paid: 'success', offered: 'default', platform: 'info', dueAtArrival: 'warning', dueAtDeparture: 'warning', inPlan: 'default' };

export default function SaleDetailList({ detail, onChangeMoment, busyRef = null }) {
  const [menu, setMenu] = useState(null);
  if (!detail || !Array.isArray(detail.lines)) return null;
  const movable = (line) => Boolean(onChangeMoment) && ['option', 'resource', 'custom'].includes(line.kind) && !line.offered && line.status !== 'paid' && line.status !== 'platform';
  return (
    <Box component="ul" aria-label="Détail des ventes" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {detail.lines.map((line) => (
        <Box
          component="li"
          key={line.ref}
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr auto', sm: '1fr auto auto' }, gap: 1, alignItems: 'center', py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
              {line.label}{line.quantity > 1 && line.kind !== 'accommodation' ? ` × ${line.quantity}` : ''}
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
              <Chip size="small" variant="outlined" label={line.sourceLabel} />
              <Chip size="small" color={STATUS_COLOR[line.status] || 'default'} variant="outlined" label={line.statusLabel} />
              {(line.discountCents > 0 || line.stayDiscountShareCents > 0) && (
                <Chip size="small" variant="outlined" label={`Remise ${euros(line.discountCents + line.stayDiscountShareCents)}`} />
              )}
            </Stack>
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euros(line.totalCents)}</Typography>
          {movable(line) && (
            <Button
              size="small"
              variant="outlined"
              disabled={busyRef === line.ref}
              onClick={(event) => setMenu({ anchor: event.currentTarget, line })}
              sx={{ minHeight: 44, gridColumn: { xs: '1 / -1', sm: 'auto' } }}
              aria-label={`Moment de ${line.label}`}
            >
              {line.momentLabel || 'Moment'}
            </Button>
          )}
        </Box>
      ))}
      <Menu anchorEl={menu && menu.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {MOMENT_CHOICES.map((choice) => (
          <MenuItem
            key={choice.value}
            selected={menu && menu.line.collectAt === choice.value}
            sx={{ minHeight: 44 }}
            onClick={() => { const { line } = menu; setMenu(null); if (line.collectAt !== choice.value) onChangeMoment(line, choice.value); }}
          >
            {choice.label}
          </MenuItem>
        ))}
      </Menu>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 1.5 }}>
        <Typography variant="body2" color="text.secondary">Reste à payer</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{euros(detail.totals && detail.totals.dueCents)}</Typography>
      </Box>
    </Box>
  );
}
