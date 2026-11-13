/**
 * StaySalesSection — what a stay sold apart from the total being collected (specs/pricing-components.md §3 rules 32, 85; mock M3).
 *
 * Props:
 *   `section` = `{ title, lines: [{ ref, label, totalCents, statusLabel, sourceLabel, block, groupLabel, addedOnReopen }], groups, totalCents, dueCents }`
 *     as the server serves it (the SAS payload's `staySales`), or null (renders nothing). Every amount is the server's cents and every label its
 *     French; nothing is summed here.
 *   `onCollectNow(refs)` (optional) — makes the section actionable: each line still to collect shows « Percevoir maintenant » and, from two lines on,
 *     « Tout percevoir maintenant » heads the list; the handler gets the refs asked and returns a promise (the buttons wait for it). The
 *     lines already paid fold under « Déjà payé » and offer nothing. Without the handler the section stays a read-only list.
 * An article sold on several lines (`groups`, rule 13) reads under one title inside each block. A line a reopened SAS appended carries the chip
 * « Ajoutée à la réouverture ». Lines wrap on a phone and the buttons keep a 44 px target; the total keeps its tabular figures.
 */
import React, { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { formatCurrency } from '../utils/formatters';

const euros = (cents) => formatCurrency((Number(cents) || 0) / 100);
const REOPEN_CHIP = 'Ajoutée à la réouverture';

export default function StaySalesSection({ section, onCollectNow = null }) {
  const [busy, setBusy] = useState(false);
  if (!section || !Array.isArray(section.lines) || section.lines.length === 0) return null;
  const groups = section.groups || [];
  const groupOf = new Map();
  groups.forEach((group) => group.refs.forEach((ref) => groupOf.set(`${group.block}:${ref}`, group)));
  const blockOf = (line) => (line.block === 'paid' ? 'paid' : 'due');
  const inBlock = (block) => section.lines.filter((line) => blockOf(line) === block);
  const entries = (block) => {
    const out = [];
    const placed = new Set();
    inBlock(block).forEach((line) => {
      const group = groupOf.get(`${block}:${line.ref}`);
      if (!group) { out.push({ line }); return; }
      if (placed.has(group.id)) return;
      placed.add(group.id);
      out.push({ group, lines: inBlock(block).filter((l) => group.refs.includes(l.ref)) });
    });
    return out;
  };
  const collect = async (refs) => {
    setBusy(true);
    try { await onCollectNow(refs); } finally { setBusy(false); }
  };
  const dueRefs = inBlock('due').map((line) => line.ref);
  const lineRow = (line, inGroup) => (
    <Stack
      component="li"
      key={line.ref}
      direction={{ xs: 'column', sm: 'row' }}
      sx={{ justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, gap: { xs: 0.5, sm: 1 }, py: 0.5, pl: inGroup ? 1.5 : 0 }}
    >
      <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {inGroup ? line.groupLabel : line.label}
        <Typography component="span" variant="caption" color="text.secondary">{` · ${line.statusLabel}`}</Typography>
        {line.addedOnReopen && (
          <Typography component="span" variant="caption" sx={{ ml: 0.75, px: 0.75, py: 0.125, borderRadius: 1, bgcolor: 'action.hover', color: 'text.primary', whiteSpace: 'nowrap' }}>
            {REOPEN_CHIP}
          </Typography>
        )}
      </Typography>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: { xs: 'space-between', sm: 'flex-end' }, gap: 1, flexShrink: 0 }}>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{euros(line.totalCents)}</Typography>
        {onCollectNow && blockOf(line) === 'due' && (
          <Button size="small" variant="outlined" disabled={busy} onClick={() => collect([line.ref])} sx={{ minHeight: 44, whiteSpace: 'nowrap' }}>
            Percevoir maintenant
          </Button>
        )}
      </Stack>
    </Stack>
  );
  const blockList = (block) => entries(block).map((entry) => (entry.group ? (
    <Box component="li" key={entry.group.id} sx={{ listStyle: 'none', pt: 0.5 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{entry.group.title}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{euros(entry.group.totalCents)}</Typography>
      </Stack>
      <Box component="ul" aria-label={entry.group.label} sx={{ listStyle: 'none', m: 0, p: 0 }}>{entry.lines.map((line) => lineRow(line, true))}</Box>
    </Box>
  ) : lineRow(entry.line, false)));
  const paidLines = inBlock('paid');
  const dueLines = inBlock('due');
  const heads = groups.length > 0 && paidLines.length > 0 && dueLines.length > 0;
  return (
    <Box component="section" aria-label={section.title} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: { xs: 1.25, sm: 1.5 } }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{section.title}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{euros(section.dueCents)}</Typography>
      </Stack>
      {onCollectNow && dueRefs.length > 1 && (
        <Button size="small" variant="contained" disabled={busy} onClick={() => collect(dueRefs)} sx={{ mt: 1, minHeight: 44, width: { xs: '100%', sm: 'auto' } }}>
          Tout percevoir maintenant
        </Button>
      )}
      {dueLines.length > 0 && (
        <Box>
          {heads && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>À percevoir</Typography>}
          <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0 }}>{blockList('due')}</Box>
        </Box>
      )}
      {paidLines.length > 0 && (dueLines.length > 0 || onCollectNow) ? (
        <Box component="details" sx={{ mt: 1, '& > summary': { cursor: 'pointer', py: 1.25 } }}>
          <Typography component="summary" variant="caption" color="text.secondary">
            {`Déjà payé · ${paidLines.length} ligne${paidLines.length > 1 ? 's' : ''}`}
          </Typography>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>{blockList('paid')}</Box>
        </Box>
      ) : paidLines.length > 0 && (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 0.5, p: 0 }}>{blockList('paid')}</Box>
      )}
    </Box>
  );
}
