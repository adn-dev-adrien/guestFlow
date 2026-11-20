/**
 * SaleDetailList — the lines a stay sold, as the server's `saleDetail` payload gives them (specs/pricing-components.md §3 rule 31).
 *
 * Props: `detail` (the payload: `lines[]`, `groups[]`, `buckets`, `totals`, `credits[]` — rule 104's « Déjà réglé (…) » money, each `{ ref, label,
 * totalCents (< 0) }`, drawn read-only after the lines; `totals.dueCents` is what the stay still asks, credits already off), `onChangeMoment(line, collectAt)` (optional: shows a « moment » menu on
 * a line the server marks `movable`, listing only that line's `moments`), `heldReason` (optional string: the menu button stays visible but
 * inert, reading this reason — the fiche holds the write while it has unsaved edits), `busyRef` (the ref of the line being changed). Nothing is computed here: amounts are the server's cents, labels the
 * server's French. An article sold on several lines (`groups`, rule 13) reads under one title with its total, each line below it with its own
 * status and moment; an offered line stays in its group, its amount struck through. Lines stack on a phone, two columns from `sm`.
 */
import React, { useState } from 'react';
import { Box, Button, Chip, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { formatCurrency } from '../utils/formatters';
import { MOMENT_LABELS } from '../constants/extraSale';

const euros = (cents) => formatCurrency((Number(cents) || 0) / 100);
const CREDIT_CHIP = 'Déjà réglé';
const STATUS_COLOR = { paid: 'success', offered: 'default', platform: 'info', dueAtArrival: 'warning', dueAtDeparture: 'warning', inPlan: 'default' };

export default function SaleDetailList({ detail, onChangeMoment, heldReason = null, busyRef = null }) {
  const [menu, setMenu] = useState(null);
  if (!detail || !Array.isArray(detail.lines)) return null;
  const movable = (line) => Boolean(onChangeMoment) && line.movable === true && Array.isArray(line.moments) && line.moments.length > 0;
  const groupOf = new Map();
  (detail.groups || []).forEach((group) => group.refs.forEach((ref) => groupOf.set(ref, group)));
  // The lines in the server's order; a group takes the place of its first line.
  const blocks = [];
  const placed = new Set();
  detail.lines.forEach((line) => {
    const group = groupOf.get(line.ref);
    if (!group) { blocks.push({ line }); return; }
    if (placed.has(group.id)) return;
    placed.add(group.id);
    blocks.push({ group, lines: detail.lines.filter((l) => group.refs.includes(l.ref)) });
  });

  const row = (line, inGroup) => (
    <Box
      component="li"
      key={line.ref}
      sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr auto', sm: '1fr auto auto' }, gap: 1, alignItems: 'center', py: 1.25, pl: inGroup ? { xs: 1.5, sm: 2 } : 0, borderBottom: '1px solid', borderColor: 'divider' }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: inGroup ? 500 : 600, overflowWrap: 'anywhere' }}>
          {inGroup ? line.groupLabel : `${line.label}${line.quantity > 1 && line.kind !== 'accommodation' ? ` × ${line.quantity}` : ''}`}
        </Typography>
        <Stack direction="row" spacing={0.75} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
          <Chip size="small" variant="outlined" label={line.sourceLabel} />
          <Chip size="small" color={STATUS_COLOR[line.status] || 'default'} variant="outlined" label={line.statusLabel} />
          {line.discountTotalCents > 0 && (
            <Chip size="small" variant="outlined" label={`Remise ${euros(line.discountTotalCents)}`} />
          )}
        </Stack>
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {line.offered && line.grossCents > 0 && (
          <Box component="del" sx={{ textDecoration: 'line-through', color: 'text.secondary', fontWeight: 400, mr: 0.75 }}>{euros(line.grossCents)}</Box>
        )}
        {euros(line.totalCents)}
      </Typography>
      {movable(line) && (
        <Button
          size="small"
          variant="outlined"
          disabled={busyRef === line.ref}
          onClick={heldReason ? undefined : (event) => setMenu({ anchor: event.currentTarget, line })}
          aria-disabled={heldReason ? true : undefined}
          sx={{ minHeight: 44, gridColumn: { xs: '1 / -1', sm: 'auto' }, ...(heldReason ? { opacity: 0.38, cursor: 'default' } : {}) }}
          aria-label={heldReason ? `Moment de ${line.label} : ${heldReason}` : `Moment de ${line.label}`}
        >
          {line.momentLabel || 'Moment'}
        </Button>
      )}
    </Box>
  );

  return (
    <Box>
      <Box component="ul" aria-label="Détail des ventes" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {blocks.map((block) => (block.group ? (
          <Box component="li" key={block.group.id} sx={{ listStyle: 'none' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'baseline', pt: 1.25 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{block.group.title}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{euros(block.group.totalCents)}</Typography>
            </Box>
            <Box component="ul" aria-label={block.group.label} sx={{ listStyle: 'none', m: 0, p: 0 }}>{block.lines.map((line) => row(line, true))}</Box>
          </Box>
        ) : row(block.line, false)))}
        {(detail.credits || []).map((credit) => (
          <Box
            component="li"
            key={credit.ref}
            sx={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 1, alignItems: 'center', py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{credit.label}</Typography>
              <Stack direction="row" spacing={0.75} sx={{ mt: 0.5 }}>
                <Chip size="small" variant="outlined" label={CREDIT_CHIP} />
              </Stack>
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{euros(credit.totalCents)}</Typography>
          </Box>
        ))}
      </Box>
      <Menu anchorEl={menu && menu.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {(menu ? menu.line.moments : []).map((moment) => (
          <MenuItem
            key={moment}
            selected={menu.line.collectAt === moment}
            sx={{ minHeight: 44 }}
            onClick={() => { const { line } = menu; setMenu(null); if (line.collectAt !== moment) onChangeMoment(line, moment); }}
          >
            {MOMENT_LABELS[moment] || moment}
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
